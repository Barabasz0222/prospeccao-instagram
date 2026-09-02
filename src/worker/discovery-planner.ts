import { and, count, eq, inArray, lt } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";
import { leads } from "@/db/schema";
import type { Business } from "@/lib/business";
import { getSetting } from "@/features/settings/repo";
import { log } from "@/lib/logger";
import { normalize } from "@/lib/text";
import { enqueue } from "./queue";

type Db = LibSQLDatabase<typeof schema>;

/** Qualified/discovered leads still waiting for their first browser DM. */
export async function pendingBacklog(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(leads)
    .where(
      and(
        inArray(leads.pipelineStage, ["discovered", "qualified"]),
        eq(leads.channelState, "browser_contact_pending"),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Closes leads that were never contacted within `leads.stale_days` (default
 * 30) — an old profile is not worth a cold DM. Returns how many were expired.
 */
export async function expireStaleLeads(db: Db): Promise<number> {
  const days = await getSetting<number>(db, "leads.stale_days", 30);
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const res = await db
    .update(leads)
    .set({ pipelineStage: "closed", channelState: "completed", updatedAt: new Date().toISOString() })
    .where(
      and(
        inArray(leads.pipelineStage, ["discovered", "qualified"]),
        eq(leads.channelState, "browser_contact_pending"),
        lt(leads.createdAt, cutoff),
      ),
    )
    .returning({ id: leads.id });
  if (res.length) log.info("leads.expired_stale", { count: res.length, olderThanDays: days });
  return res.length;
}

type Query = { kind: "keyword" | "hashtag"; term: string; limit?: number };

/** A multi-word phrase → a single hashtag token (accent-free, no spaces). */
export function toHashtag(phrase: string): string {
  return normalize(phrase).replace(/\s+/g, "");
}

/**
 * Turns the ICP config into concrete discovery queries. Each keyword becomes
 * both a hashtag hunt and a search-box hunt; the hashtag is where most real
 * profiles come from.
 */
export function planQueries(terms: string[], perTermLimit: number): Query[] {
  // Keyword (search-box) queries only — Instagram hashtag pages need heavy JS
  // and consistently return nothing when scraped, so they just waste a cycle.
  return terms.map((t) => ({ kind: "keyword" as const, term: t, limit: perTermLimit }));
}

/**
 * Enqueues one discovery run per funnel, drawing terms from business.icp
 * (customers) and business.affiliateTopics (affiliates) plus any extra
 * hashtags the operator added in settings. Autonomous — the worker calls this
 * on a schedule, no operator action.
 */
export async function enqueueDiscoveryRun(db: Db, business: Business): Promise<number> {
  await expireStaleLeads(db);

  // Backlog cap: no point discovering more while a big queue of qualified
  // leads still waits for a first DM (the daily rate limit is the bottleneck).
  const maxBacklog = await getSetting<number>(db, "discovery.max_backlog", 300);
  const backlog = await pendingBacklog(db);
  if (backlog >= maxBacklog) {
    log.info("discovery.paused_backlog", { backlog, maxBacklog });
    return 0;
  }

  const perTerm = await getSetting<number>(db, "discovery.profiles_per_term", 3);
  const extra = await getSetting<string[]>(db, "discovery.extra_hashtags", []);
  // Funil B (afiliados) só roda quando há um destino configurado
  // (links.affiliateGroup). Sem grupo/link, não há para onde encaminhar.
  const affiliateOn =
    business.links.affiliateGroup != null &&
    (await getSetting<boolean>(db, "discovery.affiliate_enabled", true));

  const bucket = new Date().toISOString().slice(0, 13); // hour bucket → idempotent restart

  const customerTerms = [...business.icp.keywords, ...business.icp.segments.slice(0, 2)];
  let n = 0;
  const c = await enqueue(db, {
    kind: "discover_from_keywords",
    payload: {
      funnel: "customer",
      queries: [
        ...planQueries(customerTerms, perTerm),
        ...extra.map((h) => ({ kind: "hashtag" as const, term: toHashtag(h), limit: perTerm })),
      ],
    },
    dedupeKey: `discovery:customer:${bucket}`,
    priority: -5,
  });
  if (c) n++;

  if (affiliateOn) {
    const a = await enqueue(db, {
      kind: "discover_from_keywords",
      payload: { funnel: "affiliate", queries: planQueries(business.affiliateTopics, perTerm) },
      dedupeKey: `discovery:affiliate:${bucket}`,
      priority: -5,
    });
    if (a) n++;
  }
  return n;
}
