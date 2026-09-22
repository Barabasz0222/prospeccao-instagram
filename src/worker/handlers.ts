import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { browserSendLog, conversations, leads } from "@/db/schema";
import * as schema from "@/db/schema";
import { discoverLead } from "@/features/leads/repo";
import { priorityFromScore, scoreLead } from "@/features/leads/scoring";
import { assignVariant, recordOutcome } from "@/features/experiments/repo";
import {
  DuplicateSendError,
  handleInboundReply,
  moveChannel,
  recordOutbound,
} from "@/features/conversations/repo";
import {
  classifyIntent,
  decideReply,
  generateOpener,
  isConstructionLead,
} from "@/features/conversations/engine";
import { stripDashes } from "@/lib/text";
import { loadBusiness } from "@/lib/business";
import { getBrowserDriver } from "@/integrations/browser";
import { resolveIgUsername, sendApiMessage } from "@/integrations/instagram/api";
import { getAccessToken, refreshAccessToken, tokenDaysLeft } from "@/integrations/instagram/token";
import { getSetting, isSystemPaused, setSetting } from "@/features/settings/repo";
import { loadEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { browserMutex } from "@/lib/mutex";
import { randomBetween } from "@/lib/time";
import { browserSendGate, incrementSendCounter } from "./rate-limit";
import { checkCircuitBreaker, raiseAlert, tripAndPause } from "./safety";
import { enqueue } from "./queue";

type Db = LibSQLDatabase<typeof schema>;

export type JobContext = { db: Db; workerId: string };

const FIRST_RUN_KEY = "worker.first_run_at";

async function firstRunAt(db: Db): Promise<Date> {
  const stored = await getSetting<string | null>(db, FIRST_RUN_KEY, null);
  if (stored) return new Date(stored);
  const nowIso = new Date().toISOString();
  await setSetting(db, FIRST_RUN_KEY, nowIso, "worker");
  return new Date(nowIso);
}

// ── discover_profiles ────────────────────────────────────────────────────────
type DiscoverPayload = {
  funnel: "customer" | "affiliate";
  candidates: {
    igUsername: string;
    profileUrl: string;
    displayName?: string;
    bio?: string;
    category?: string;
    location?: string;
    followerCount?: number;
    sourceKeyword?: string;
    discoverySource?: string;
  }[];
};

export async function handleDiscoverProfiles(ctx: JobContext, payload: DiscoverPayload) {
  let created = 0;
  let duplicate = 0;
  let blocked = 0;
  const ownHandle = loadBusiness().company.instagramHandle.toLowerCase().replace(/^@/, "");
  for (const c of payload.candidates) {
    if (c.igUsername.toLowerCase().replace(/^@/, "") === ownHandle) continue; // skip our own account
    const res = await discoverLead(ctx.db, {
      funnel: payload.funnel,
      igUsername: c.igUsername,
      profileUrl: c.profileUrl,
      displayName: c.displayName ?? null,
      bio: c.bio ?? null,
      category: c.category ?? null,
      location: c.location ?? null,
      followerCount: c.followerCount ?? null,
      sourceKeyword: c.sourceKeyword ?? null,
      discoverySource: c.discoverySource ?? "manual_seed",
      actorType: "unknown",
    });
    if (res.status === "created") {
      created++;
      const needsEnrich = (c.discoverySource ?? "").startsWith("browser") && !c.bio;
      await enqueue(ctx.db, {
        kind: needsEnrich ? "enrich_profile" : "score_lead",
        payload: { leadId: res.leadId },
        dedupeKey: `${needsEnrich ? "enrich" : "score"}:${res.leadId}`,
      });
    } else if (res.status === "duplicate") duplicate++;
    else blocked++;
  }
  log.info("discover.done", { created, duplicate, blocked });
  return { created, duplicate, blocked };
}

// ── enrich_profile ───────────────────────────────────────────────────────────
export async function handleEnrichProfile(ctx: JobContext, payload: { leadId: number }) {
  const { db } = ctx;
  if (await isSystemPaused(db)) return { skipped: "system_paused" };

  const [lead] = await db.select().from(leads).where(eq(leads.id, payload.leadId)).limit(1);
  if (!lead) throw new Error(`lead ${payload.leadId} inexistente`);
  if (lead.pipelineStage !== "discovered") return { skipped: `stage=${lead.pipelineStage}` };

  const signals = await browserMutex.runExclusive(() =>
    getBrowserDriver().enrichProfile(lead.igUsername),
  );

  if (!signals || signals.isPrivate) {
    // Gone / unreadable / private — drop it, don't DM blind.
    await db
      .update(leads)
      .set({ pipelineStage: "closed", updatedAt: new Date().toISOString() })
      .where(eq(leads.id, lead.id));
    await db.insert(schema.events).values({
      leadId: lead.id,
      type: signals?.isPrivate ? "skipped_private" : "enrich_failed",
      data: {},
    });
    return { enriched: false, reason: signals?.isPrivate ? "private" : "unreadable" };
  }

  await db
    .update(leads)
    .set({
      displayName: signals.displayName,
      bio: signals.bio,
      category: signals.category,
      location: signals.location,
      followerCount: signals.followerCount,
      publicSignals: {
        ...(lead.publicSignals ?? {}),
        followingCount: signals.followingCount,
        postCount: signals.postCount,
        externalUrl: signals.externalUrl,
        isPrivate: signals.isPrivate,
        isVerified: signals.isVerified,
        bioHashtags: signals.bioHashtags,
      },
      updatedAt: new Date().toISOString(),
    })
    .where(eq(leads.id, lead.id));

  await enqueue(db, { kind: "score_lead", payload: { leadId: lead.id }, dedupeKey: `score:${lead.id}` });
  return { enriched: true, followers: signals.followerCount };
}

// ── refresh_ig_token ─────────────────────────────────────────────────────────
export async function handleRefreshIgToken(ctx: JobContext) {
  const { db } = ctx;
  const days = await tokenDaysLeft(db);
  if (days != null && days > 10) return { skipped: `token ok (${Math.round(days)}d)` };

  const r = await refreshAccessToken(db);
  if (!r.ok) {
    await raiseAlert(db, "instagram_api", "critical", `renovação do token falhou: ${r.reason}`);
    return { ok: false, reason: r.reason };
  }
  await raiseAlert(db, "instagram_api", "info", "token do Instagram renovado (+60 dias)");
  return { ok: true };
}

// ── discover_from_keywords ───────────────────────────────────────────────────
type DiscoverFromKeywordsPayload = {
  funnel: "customer" | "affiliate";
  queries: { kind: "keyword" | "hashtag"; term: string; limit?: number }[];
};

/**
 * Fan-out only: one short job per query so a long crawl never blocks DMs or
 * inbound replies. Each `discover_one` holds the browser for a single term.
 */
export async function handleDiscoverFromKeywords(ctx: JobContext, payload: DiscoverFromKeywordsPayload) {
  const { db } = ctx;
  if (await isSystemPaused(db)) return { skipped: "system_paused" };

  let queued = 0;
  for (const q of payload.queries) {
    const id = await enqueue(db, {
      kind: "discover_one",
      payload: { funnel: payload.funnel, query: { ...q, limit: q.limit ?? 8 } },
      dedupeKey: `discover_one:${payload.funnel}:${q.kind}:${q.term}:${new Date().toISOString().slice(0, 13)}`,
      priority: -6,
    });
    if (id) queued++;
  }
  log.info("discover.fanout", { funnel: payload.funnel, queued });
  return { queued };
}

type DiscoverOnePayload = {
  funnel: "customer" | "affiliate";
  query: { kind: "keyword" | "hashtag" | "related"; term: string; limit: number };
};

export async function handleDiscoverOne(ctx: JobContext, payload: DiscoverOnePayload) {
  const { db } = ctx;
  if (await isSystemPaused(db)) return { skipped: "system_paused" };
  const { query, funnel } = payload;

  const found = await browserMutex.runExclusive(() => getBrowserDriver().discoverProfiles(query));
  log.info("discover.one", { term: query.term, kind: query.kind, found: found.length });
  if (found.length === 0) return { term: query.term, found: 0 };

  await enqueue(db, {
    kind: "discover_profiles",
    payload: {
      funnel,
      candidates: found.map((p) => ({
        igUsername: p.igUsername,
        profileUrl: p.profileUrl,
        displayName: p.displayName,
        bio: p.bio,
        category: p.category,
        location: p.location,
        followerCount: p.followerCount,
        sourceKeyword: query.term,
        discoverySource: `browser_${query.kind}`,
      })),
    } satisfies DiscoverPayload,
    priority: -3,
  });
  return { term: query.term, found: found.length };
}

// ── score_lead ───────────────────────────────────────────────────────────────
const QUALIFY_THRESHOLD_KEY = "leads.qualify_threshold";
const OPENER_EXPERIMENT = "opener_copy_v1";

export async function handleScoreLead(ctx: JobContext, payload: { leadId: number }) {
  const { db } = ctx;
  const [lead] = await db.select().from(leads).where(eq(leads.id, payload.leadId)).limit(1);
  if (!lead) throw new Error(`lead ${payload.leadId} inexistente`);
  if (lead.pipelineStage !== "discovered") return { skipped: `stage=${lead.pipelineStage}` };

  const business = loadBusiness();
  const score = scoreLead(lead, business);
  const priority = priorityFromScore(score.icpScore, score.actorType);
  const tags = Array.from(new Set([...(lead.tags ?? []), ...score.matchedKeywords.slice(0, 3)]));

  await db
    .update(leads)
    .set({
      icpScore: score.icpScore,
      actorType: score.actorType,
      niche: score.niche,
      tags,
      priority,
      publicSignals: { ...(lead.publicSignals ?? {}), scoreReasons: score.reasons },
      updatedAt: new Date().toISOString(),
    })
    .where(eq(leads.id, lead.id));

  await db.insert(schema.events).values({
    leadId: lead.id,
    type: "lead_scored",
    data: { icpScore: score.icpScore, actorType: score.actorType, priority },
  });

  const threshold = await getSetting<number>(db, QUALIFY_THRESHOLD_KEY, 0.4);
  // Operator-supplied leads bypass the score gate — the operator already
  // decided they are worth contacting.
  const manual = (lead.discoverySource ?? "").startsWith("manual");
  if (!manual && score.icpScore < threshold) {
    await db.insert(schema.decisionsLog).values({
      leadId: lead.id,
      actor: "ai",
      decision: "hold",
      rationale: `Score ${score.icpScore} < limiar ${threshold}. Não qualificar.`,
      inputs: { reasons: score.reasons },
    });
    return { scored: score.icpScore, qualified: false };
  }

  await db
    .update(leads)
    .set({ pipelineStage: "qualified", updatedAt: new Date().toISOString() })
    .where(eq(leads.id, lead.id));

  // The opener variant is picked now; the message itself is generated by the
  // DM dispatcher right before it sends (so no wasted AI call if the lead never
  // gets contacted, and no per-lead job that can get stuck).
  const variantId = (await assignVariant(db, OPENER_EXPERIMENT, lead.id)) ?? "opener_A";

  await db.insert(schema.decisionsLog).values({
    leadId: lead.id,
    actor: "ai",
    decision: "qualified",
    rationale: `Score ${score.icpScore} (${score.actorType}). Variante ${variantId}. Na fila para 1ª DM.`,
  });

  return { scored: score.icpScore, qualified: true, variantId };
}

// ── browser send (first DM + follow-up share this path) ──────────────────────
type FollowupPayload = { leadId: number; kind: "browser" | "api" };

/**
 * Sends one message through the browser. `first_dm` calls come from the
 * dispatcher (no job); `followup` calls come from a delayed job. On a gate or
 * breaker block the caller decides whether/when to retry — nothing is
 * re-enqueued here (that was the source of the stuck-lead bug).
 */
async function runBrowserSend(
  ctx: JobContext,
  opts: {
    lead: schema.Lead;
    message: string;
    variantId?: string;
    kind: "first_dm" | "followup";
  },
) {
  const { db } = ctx;
  const { lead } = opts;

  const breaker = await checkCircuitBreaker(db);
  if (breaker.tripped) {
    await tripAndPause(db, "browser", breaker.reason ?? "circuit breaker");
    return { skipped: "circuit_breaker" };
  }

  const gate = await browserSendGate(db, { firstRunAt: await firstRunAt(db) });
  if (!gate.allowed) {
    return { skipped: gate.reason };
  }

  return browserMutex.runExclusive(async () => {
    const driver = getBrowserDriver();
    const env = loadEnv();
    const result = await driver.sendDm({
      jobId: 0,
      leadId: lead.id,
      profileUrl: lead.profileUrl,
      igUsername: lead.igUsername,
      message: opts.message,
      variantId: opts.variantId,
    });

    await db.insert(browserSendLog).values({
      leadId: lead.id,
      mode: env.BROWSER_SEND_MODE,
      variantId: opts.variantId,
      body: opts.message,
      // Only a real dry-run stop logs as "blocked"; anything else that isn't a
      // clean send logs as "failed" so a systemic selector break trips the
      // circuit breaker instead of grinding the whole queue.
      result:
        result.status === "sent"
          ? "sent"
          : result.status === "blocked" && result.reason.startsWith("dry_run")
            ? "blocked"
            : "failed",
      screenshotPath: result.evidence.screenshotPath,
      accessibilitySnapshotPath: result.evidence.accessibilitySnapshotPath,
      url: result.evidence.url,
      consoleErrors: result.evidence.consoleErrors,
      networkFailures: result.evidence.networkFailures,
      error: result.status === "failed" ? result.error : result.status === "blocked" ? result.reason : null,
    });

    // A lost session blocks EVERY lead — pause the whole system, don't burn leads.
    if (result.status === "blocked" && result.reason.includes("não está logada")) {
      await tripAndPause(db, "browser", result.reason);
      return { blocked: result.reason };
    }
    if (result.status === "blocked" && result.reason.startsWith("dry_run")) {
      return { blocked: result.reason };
    }

    // Everything else that isn't a clean send — a real failure OR "no message
    // button" / "composer didn't open" (could be a restricted account OR our
    // selector) — counts as an attempt. After 3, the lead goes to human review
    // so the dispatcher moves on and stops re-paying for openers. The lead is
    // never silently closed.
    if (result.status === "failed" || result.status === "blocked") {
      const reason = result.status === "failed" ? result.error : result.reason;
      if (result.status === "failed" && result.error.startsWith("browser_unavailable")) {
        await tripAndPause(db, "browser", result.error);
      }
      const attempts = ((lead.publicSignals?.dmAttempts as number | undefined) ?? 0) + 1;
      await db
        .update(leads)
        .set({
          publicSignals: { ...(lead.publicSignals ?? {}), dmAttempts: attempts, lastDmError: reason.slice(0, 200) },
          ...(attempts >= 3 ? { channelState: "human_review_required" as const } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(leads.id, lead.id));
      if (attempts >= 3) {
        await db.insert(schema.exceptions).values({
          leadId: lead.id,
          kind: "dm_send_failed",
          detail: `3 tentativas de 1ª DM falharam. Último: ${reason.slice(0, 300)}`,
        });
      }
      await raiseAlert(db, "browser", "warning", `1ª DM não saiu (${attempts}x): ${reason}`);
      return { failed: reason, attempts };
    }

    try {
      await recordOutbound(db, {
        leadId: lead.id,
        channel: "browser",
        body: opts.message,
        variantId: opts.variantId,
        externalId: `browser-${opts.kind}-${lead.id}-${Date.now()}`,
      });
    } catch (e) {
      if (!(e instanceof DuplicateSendError)) throw e;
    }
    await incrementSendCounter(db, "browser");

    if (opts.kind === "first_dm") {
      await moveChannel(db, lead.id, "browser_contact_sent");
      await moveChannel(db, lead.id, "waiting_inbound_reply");
      await db
        .update(leads)
        .set({ pipelineStage: "contacted", updatedAt: new Date().toISOString() })
        .where(eq(leads.id, lead.id));
      await recordOutcome(db, OPENER_EXPERIMENT, lead.id, "contacted");
      // Schedule a single follow-up if no reply comes — unless the operator
      // turned follow-ups off (they compete with new leads for the same
      // daily send cap).
      const followupsEnabled = await getSetting<boolean>(db, "followup.enabled", true);
      if (followupsEnabled) {
        const days = await getSetting<number>(db, "followup.delay_days", 3);
        await enqueue(db, {
          kind: "send_followup",
          payload: { leadId: lead.id, kind: "browser" } satisfies FollowupPayload,
          runAt: new Date(Date.now() + days * 86_400_000),
          dedupeKey: `fup:${lead.id}`,
        });
      }
    }

    const wait = randomBetween(env.MIN_SECONDS_BETWEEN_DMS, env.MAX_SECONDS_BETWEEN_DMS);
    log.info(opts.kind === "first_dm" ? "dm.sent" : "followup.sent", {
      leadId: lead.id,
      nextEligibleInSec: wait,
    });
    return { sent: true, cooldownSec: wait };
  });
}

/**
 * Sends the first DM to the highest-priority qualified lead that has not been
 * contacted yet. Called by the worker loop on a cooldown. Returns the cooldown
 * in seconds after a real send, or a skip reason.
 */
export async function dispatchNextDm(ctx: JobContext): Promise<{
  sent?: number;
  cooldownSec?: number;
  skipped?: string;
}> {
  const { db } = ctx;
  if (await isSystemPaused(db)) return { skipped: "system_paused" };

  // Check gate + breaker BEFORE picking a lead / paying for an opener.
  const breaker = await checkCircuitBreaker(db);
  if (breaker.tripped) {
    await tripAndPause(db, "browser", breaker.reason ?? "circuit breaker");
    return { skipped: "circuit_breaker" };
  }
  const gate = await browserSendGate(db, { firstRunAt: await firstRunAt(db) });
  if (!gate.allowed) return { skipped: gate.reason };

  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.pipelineStage, "qualified"), eq(leads.channelState, "browser_contact_pending")))
    .orderBy(desc(leads.priority), desc(leads.icpScore), asc(leads.updatedAt))
    .limit(1);
  if (!lead) return { skipped: "no_qualified_lead" };

  const variantId = (await assignVariant(db, OPENER_EXPERIMENT, lead.id)) ?? "opener_A";
  const message = await generateOpener({
    funnel: lead.funnel,
    displayName: lead.displayName,
    igUsername: lead.igUsername,
    bio: lead.bio,
    category: lead.category,
    location: lead.location,
    niche: lead.niche,
    sourceKeyword: lead.sourceKeyword,
    variantId,
    leadId: lead.id,
  });

  const res = await runBrowserSend(ctx, { lead, message, variantId, kind: "first_dm" });
  if ("sent" in res) return { sent: lead.id, cooldownSec: res.cooldownSec };
  if ("blocked" in res) return { skipped: `blocked:${res.blocked}` };
  if ("failed" in res) return { skipped: `failed(${res.attempts}x):${res.failed}` };
  return { skipped: res.skipped ?? "unknown" };
}

// ── send_followup ────────────────────────────────────────────────────────────
export async function handleSendFollowup(ctx: JobContext, payload: FollowupPayload) {
  const { db } = ctx;
  if (await isSystemPaused(db)) return { skipped: "system_paused" };
  if (!(await getSetting<boolean>(db, "followup.enabled", true))) return { skipped: "followup_disabled" };

  const [lead] = await db.select().from(leads).where(eq(leads.id, payload.leadId)).limit(1);
  if (!lead) throw new Error(`lead ${payload.leadId} inexistente`);

  // Only follow up a thread that is still silent on the browser side.
  if (lead.channelState !== "waiting_inbound_reply") {
    return { skipped: `channel_state=${lead.channelState}` };
  }

  const [conv] = await db.select().from(conversations).where(eq(conversations.leadId, lead.id)).limit(1);
  if (!conv) return { skipped: "no_conversation" };
  if (conv.lastInboundAt) return { skipped: "already_replied" };

  const threadMessages = await db.query.messages.findMany({
    where: (m, { eq: e }) => e(m.conversationId, conv.id),
  });
  const outboundCount = threadMessages.filter((m) => m.direction === "outbound").length;
  const maxFollowups = await getSetting<number>(db, "followup.max", 1);
  // outboundCount already includes the first DM; allow up to maxFollowups extra.
  if (outboundCount > maxFollowups) return { skipped: "followup_limit" };

  const business = loadBusiness();
  const nudge = stripDashes(
    lead.funnel === "affiliate"
      ? `Oi de novo! Só retomando. Se fizer sentido conversarmos sobre o programa de afiliados da ${business.company.name}, é só me chamar. Sem problema se não for o momento.`
      : `Oi! Passando pra retomar. Se quiser, te mostro rapidinho um caso da ${business.company.name}. Se não for a hora, tudo certo, é só avisar.`,
  );

  const res = await runBrowserSend(ctx, { lead, message: nudge, kind: "followup" });
  // A gate/breaker skip just means "try again on the next scheduled sweep":
  // re-enqueue with a fresh delay and NO dedupeKey (so it can't collide with
  // this still-running job — that was the stuck-lead bug).
  if ("skipped" in res && (res.skipped === "circuit_breaker" || res.skipped?.includes("janela") || res.skipped?.includes("limite"))) {
    await enqueue(db, {
      kind: "send_followup",
      payload: { leadId: lead.id, kind: "browser" } satisfies FollowupPayload,
      runAt: new Date(Date.now() + 60 * 60_000),
    });
  }
  return res;
}

// ── process_inbound ──────────────────────────────────────────────────────────
type ProcessInboundPayload = {
  metaUserId: string;
  externalId: string;
  text: string;
  receivedAt: string;
};

export async function handleProcessInbound(ctx: JobContext, payload: ProcessInboundPayload) {
  const { db } = ctx;

  const handoff = await handleInboundReply(db, {
    metaUserId: payload.metaUserId,
    externalId: payload.externalId,
    text: payload.text,
    receivedAt: payload.receivedAt,
    resolveLeadId: async (metaUserId) => {
      // 1) Best-effort: match by ig_user_id already stored on the lead.
      const [byId] = await db.select().from(leads).where(eq(leads.igUserId, metaUserId)).limit(1);
      if (byId) return byId.id;

      // 2) First reply from a lead whose only DM went out via the browser —
      // we never learned their numeric id. Resolve it via the Graph API and
      // match by @username instead, then save the id for next time.
      const username = await resolveIgUsername(metaUserId, await getAccessToken(db));
      if (!username) return null;
      const [byUsername] = await db
        .select()
        .from(leads)
        .where(sql`lower(${leads.igUsername}) = lower(${username})`)
        .limit(1);
      if (!byUsername) return null;
      await db.update(leads).set({ igUserId: metaUserId }).where(eq(leads.id, byUsername.id));
      return byUsername.id;
    },
  });

  if (!handoff.matched) {
    await raiseAlert(db, "webhook", "warning", `resposta sem lead correspondente (meta ${payload.metaUserId})`);
    return { matched: false };
  }
  if (handoff.alreadyProcessed) {
    return { matched: true, alreadyProcessed: true };
  }

  const leadId = handoff.leadId!;
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  const [conv] = await db.select().from(conversations).where(eq(conversations.leadId, leadId)).limit(1);
  if (!lead || !conv) return { matched: true, note: "sem contexto" };

  await db
    .update(leads)
    .set({ pipelineStage: "replied", updatedAt: new Date().toISOString() })
    .where(eq(leads.id, leadId));
  await recordOutcome(db, OPENER_EXPERIMENT, leadId, "replied");
  await db.insert(schema.events).values({ leadId, type: "inbound_reply", data: {} });

  const history = await conversationHistory(db, conv.id);
  const { intent } = await classifyIntent(payload.text, { funnel: lead.funnel, history }, leadId);

  if (intent === "opt_out") {
    await moveChannel(db, leadId, "do_not_contact");
    await db
      .update(leads)
      .set({ pipelineStage: "closed", updatedAt: new Date().toISOString() })
      .where(eq(leads.id, leadId));
    await raiseAlert(db, "engine", "info", `lead ${leadId} pediu opt-out`);
    return { matched: true, intent };
  }

  const decision = await decideReply({
    intent,
    funnel: lead.funnel,
    history,
    profileSummary: `${lead.displayName ?? lead.igUsername}. ${lead.bio ?? ""} (${lead.category ?? "?"})`,
    isConstruction: isConstructionLead({
      bio: lead.bio,
      category: lead.category,
      displayName: lead.displayName,
      niche: lead.niche,
      sourceKeyword: lead.sourceKeyword,
    }),
    leadId,
  });

  await db.insert(schema.decisionsLog).values({
    leadId,
    actor: "ai",
    decision: decision.action,
    rationale: decision.rationale,
    inputs: { intent },
  });

  if (decision.action === "escalate_human") {
    await moveChannel(db, leadId, "human_review_required");
    await db.insert(schema.exceptions).values({ leadId, kind: "needs_human", detail: decision.rationale });
    return { matched: true, intent, action: decision.action };
  }

  if (decision.action === "forward_whatsapp") {
    const stage = lead.funnel === "customer" ? "whatsapp_handoff" : "interested";
    await db
      .update(leads)
      .set({ pipelineStage: stage, updatedAt: new Date().toISOString() })
      .where(eq(leads.id, leadId));
    await recordOutcome(db, OPENER_EXPERIMENT, leadId, stage);
    await db.insert(schema.events).values({ leadId, type: "whatsapp_handoff", data: { funnel: lead.funnel } });
  } else if (["present", "handle_objection", "ask"].includes(decision.action)) {
    await db
      .update(leads)
      .set({ pipelineStage: "interested", updatedAt: new Date().toISOString() })
      .where(eq(leads.id, leadId));
  }

  if (decision.message) {
    const res = await sendApiMessage(payload.metaUserId, decision.message, {
      recipientOptedOut: false,
      channelOwner: conv.ownerChannel,
      lastInboundAt: conv.lastInboundAt,
      accessToken: await getAccessToken(db),
    });
    if (res.status === "sent") {
      await recordOutbound(db, {
        leadId,
        channel: "api",
        body: decision.message,
        externalId: res.externalId,
      });
    } else if (res.status === "failed") {
      await raiseAlert(db, "instagram_api", "warning", `falha ao enviar: ${res.error}`);
    }
  }

  return { matched: true, intent, action: decision.action };
}

async function conversationHistory(db: Db, conversationId: number): Promise<string> {
  const rows = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(schema.messages.sentAt);
  return rows
    .map((m) => `${m.direction === "outbound" ? "NÓS" : "LEAD"} (${m.channel}): ${m.body}`)
    .join("\n");
}
