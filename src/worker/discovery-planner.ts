import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";
import type { Business } from "@/lib/business";
import { getSetting } from "@/features/settings/repo";
import { normalize } from "@/lib/text";
import { enqueue } from "./queue";

type Db = LibSQLDatabase<typeof schema>;

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
