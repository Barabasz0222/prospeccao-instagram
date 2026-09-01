import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  conversations,
  leads,
  messages,
  metaIdentityMap,
} from "@/db/schema";
import * as schema from "@/db/schema";
import {
  canTransitionChannel,
  canTransitionPipeline,
  isTerminalChannel,
  type ChannelState,
} from "@/lib/states";

type Db = LibSQLDatabase<typeof schema>;
const nowIso = () => new Date().toISOString();

export async function ensureConversation(db: Db, leadId: number) {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.leadId, leadId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(conversations)
    .values({ leadId, ownerChannel: "browser" })
    .returning();
  return created!;
}

export class DuplicateSendError extends Error {}

/**
 * Records an outbound message. Throws DuplicateSendError if the channel does
 * not currently own the conversation — the lock that prevents the browser and
 * the API from both sending on the same thread.
 */
export async function recordOutbound(
  db: Db,
  args: {
    leadId: number;
    channel: "browser" | "api";
    body: string;
    variantId?: string;
    externalId?: string;
  },
): Promise<number> {
  const conv = await ensureConversation(db, args.leadId);
  if (conv.ownerChannel !== args.channel) {
    throw new DuplicateSendError(
      `canal ${args.channel} não é dono da conversa (dono: ${conv.ownerChannel})`,
    );
  }
  const [row] = await db
    .insert(messages)
    .values({
      conversationId: conv.id,
      direction: "outbound",
      channel: args.channel,
      body: args.body,
      variantId: args.variantId,
      externalId: args.externalId,
    })
    .returning({ id: messages.id });
  await db
    .update(conversations)
    .set({ lastOutboundAt: nowIso(), updatedAt: nowIso() })
    .where(eq(conversations.id, conv.id));
  return row!.id;
}

/**
 * Handoff: an inbound reply arrived via the Meta webhook. Match the Meta user
 * id to our lead, transfer channel ownership from browser to API, and open the
 * messaging window.
 */
export async function handleInboundReply(
  db: Db,
  args: {
    metaUserId: string;
    externalId: string;
    text: string;
    receivedAt: string;
    /** Resolver: which lead does this Meta user correspond to? */
    resolveLeadId: (metaUserId: string) => Promise<number | null>;
  },
): Promise<{
  matched: boolean;
  leadId?: number;
  conversationId?: number;
  alreadyProcessed?: boolean;
}> {
  let [mapping] = await db
    .select()
    .from(metaIdentityMap)
    .where(eq(metaIdentityMap.metaUserId, args.metaUserId))
    .limit(1);

  if (!mapping) {
    const leadId = await args.resolveLeadId(args.metaUserId);
    if (!leadId) return { matched: false };
    [mapping] = await db
      .insert(metaIdentityMap)
      .values({ metaUserId: args.metaUserId, leadId })
      .onConflictDoNothing()
      .returning();
    if (!mapping) {
      [mapping] = await db
        .select()
        .from(metaIdentityMap)
        .where(eq(metaIdentityMap.metaUserId, args.metaUserId))
        .limit(1);
    }
  }

  const leadId = mapping!.leadId;
  const conv = await ensureConversation(db, leadId);

  // Idempotent: ignore a webhook we already processed.
  const [dupe] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conv.id), eq(messages.externalId, args.externalId)))
    .limit(1);
  if (dupe) return { matched: true, leadId, conversationId: conv.id, alreadyProcessed: true };

  await db.insert(messages).values({
    conversationId: conv.id,
    direction: "inbound",
    channel: "api",
    body: args.text,
    externalId: args.externalId,
  });

  await db
    .update(conversations)
    .set({
      ownerChannel: "api",
      lastInboundAt: args.receivedAt,
      apiWindowExpiresAt: new Date(
        new Date(args.receivedAt).getTime() + 24 * 60 * 60 * 1000,
      ).toISOString(),
      updatedAt: nowIso(),
    })
    .where(eq(conversations.id, conv.id));

  // An inbound reply always promotes the channel to the API, stepping through
  // api_eligible so the transition guard stays honest. Terminal states
  // (do_not_contact, blocked, completed) are left untouched.
  const cur = await currentChannel(db, leadId);
  if (cur !== "api_active" && !isTerminalChannel(cur) && cur !== "blocked") {
    if (cur !== "api_eligible") await moveChannel(db, leadId, "api_eligible");
    await moveChannel(db, leadId, "api_active");
  }
  return { matched: true, leadId, conversationId: conv.id };
}

async function currentChannel(db: Db, leadId: number): Promise<ChannelState> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new Error(`lead ${leadId} inexistente`);
  return lead.channelState as ChannelState;
}

/**
 * Advances the pipeline to `to`, stepping through every intermediate stage in
 * the funnel order so each transition stays valid and auditable. No-op if the
 * lead is already at or past `to`. Refuses backward moves.
 */
export async function advancePipeline(db: Db, leadId: number, to: string): Promise<void> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new Error(`lead ${leadId} inexistente`);
  const order = pipelineOrder(lead.funnel);
  const fromIdx = order.indexOf(lead.pipelineStage);
  const toIdx = order.indexOf(to);
  if (toIdx === -1) throw new Error(`etapa desconhecida: ${to}`);
  if (toIdx <= fromIdx) return;
  for (let i = fromIdx + 1; i <= toIdx; i++) {
    await movePipeline(db, leadId, order[i]!);
  }
}

function pipelineOrder(funnel: "customer" | "affiliate"): readonly string[] {
  return funnel === "customer"
    ? ["discovered", "qualified", "contacted", "replied", "interested", "whatsapp_handoff", "registered", "active_customer", "closed"]
    : ["discovered", "qualified", "contacted", "replied", "interested", "joined_affiliate_group", "active_affiliate", "generated_customer", "closed"];
}

/** Guarded pipeline-stage transition on the lead. */
export async function movePipeline(db: Db, leadId: number, to: string): Promise<void> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new Error(`lead ${leadId} inexistente`);
  if (lead.pipelineStage === to) return;
  if (!canTransitionPipeline(lead.funnel, lead.pipelineStage, to)) {
    throw new Error(`transição de pipeline inválida (${lead.funnel}): ${lead.pipelineStage} -> ${to}`);
  }
  await db
    .update(leads)
    .set({ pipelineStage: to, updatedAt: nowIso() })
    .where(eq(leads.id, leadId));
}

/** Guarded channel-state transition on the lead. */
export async function moveChannel(db: Db, leadId: number, to: ChannelState): Promise<void> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new Error(`lead ${leadId} inexistente`);
  const from = lead.channelState as ChannelState;
  if (from === to) return;
  if (!canTransitionChannel(from, to)) {
    throw new Error(`transição de canal inválida: ${from} -> ${to}`);
  }
  await db
    .update(leads)
    .set({ channelState: to, updatedAt: nowIso() })
    .where(eq(leads.id, leadId));
}
