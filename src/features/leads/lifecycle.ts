import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { events, leads } from "@/db/schema";
import * as schema from "@/db/schema";
import { advancePipeline } from "@/features/conversations/repo";
import { recordOutcome } from "@/features/experiments/repo";

type Db = LibSQLDatabase<typeof schema>;
const nowIso = () => new Date().toISOString();

export type CustomerSignal =
  | { type: "registered"; igUsername?: string; leadId?: number; externalRef?: string }
  | { type: "active_customer"; igUsername?: string; leadId?: number; monthlyValueBrl?: number }
  | { type: "affiliate_joined"; igUsername?: string; leadId?: number }
  | { type: "affiliate_generated_customer"; igUsername?: string; leadId?: number; customerHandle?: string };

const OPENER_EXPERIMENT = "opener_copy_v1";

async function resolveLead(db: Db, s: { igUsername?: string; leadId?: number }) {
  if (s.leadId) {
    const [l] = await db.select().from(leads).where(eq(leads.id, s.leadId)).limit(1);
    return l ?? null;
  }
  if (s.igUsername) {
    const u = s.igUsername.toLowerCase().replace(/^@/, "");
    const [l] = await db.select().from(leads).where(eq(leads.igUsername, u)).limit(1);
    return l ?? null;
  }
  return null;
}

/**
 * Applies an external lifecycle signal (from CRM, billing, affiliate portal)
 * to a lead: advances the pipeline and records the experiment outcome. This is
 * how `registered` / `active_customer` / `generated_customer` get set — the
 * system never infers them from a conversation.
 */
export async function applyCustomerSignal(
  db: Db,
  signal: CustomerSignal,
): Promise<{ ok: boolean; leadId?: number; stage?: string; reason?: string }> {
  const lead = await resolveLead(db, signal);
  if (!lead) return { ok: false, reason: "lead_not_found" };

  const map: Record<CustomerSignal["type"], string> = {
    registered: "registered",
    active_customer: "active_customer",
    affiliate_joined: "joined_affiliate_group",
    affiliate_generated_customer: "generated_customer",
  };
  const target = map[signal.type];

  try {
    await advancePipeline(db, lead.id, target);
  } catch (e) {
    return { ok: false, leadId: lead.id, reason: e instanceof Error ? e.message : "invalid_transition" };
  }

  await recordOutcome(db, OPENER_EXPERIMENT, lead.id, target);
  await db.insert(events).values({
    leadId: lead.id,
    type: `signal_${signal.type}`,
    data: signal as unknown as Record<string, unknown>,
    occurredAt: nowIso(),
  });

  return { ok: true, leadId: lead.id, stage: target };
}
