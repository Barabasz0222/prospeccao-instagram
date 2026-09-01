import { and, eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { createHash } from "node:crypto";
import { experimentAssignments, experiments } from "@/db/schema";
import * as schema from "@/db/schema";

type Db = LibSQLDatabase<typeof schema>;

export type Variant = { id: string; label: string; weight: number; isControl: boolean };

/**
 * Deterministic weighted assignment. The same (experiment, lead) always maps
 * to the same variant (hash-based), so re-runs never reshuffle a lead and the
 * split stays controlled. One experiment per variable is the caller's rule.
 */
export function pickVariant(experimentKey: string, leadId: number, variants: Variant[]): Variant {
  const total = variants.reduce((s, v) => s + v.weight, 0) || 1;
  const h = createHash("sha256").update(`${experimentKey}:${leadId}`).digest();
  const r = (h.readUInt32BE(0) / 0xffffffff) * total;
  let acc = 0;
  for (const v of variants) {
    acc += v.weight;
    if (r <= acc) return v;
  }
  return variants[variants.length - 1]!;
}

/** Returns the variant id for a lead, assigning (and recording) on first call. */
export async function assignVariant(
  db: Db,
  experimentKey: string,
  leadId: number,
): Promise<string | null> {
  const [exp] = await db
    .select()
    .from(experiments)
    .where(eq(experiments.key, experimentKey))
    .limit(1);
  if (!exp || exp.status !== "running") return null;

  const [existing] = await db
    .select()
    .from(experimentAssignments)
    .where(
      and(
        eq(experimentAssignments.experimentId, exp.id),
        eq(experimentAssignments.leadId, leadId),
      ),
    )
    .limit(1);
  if (existing) return existing.variantId;

  const variant = pickVariant(exp.key, leadId, exp.variants as Variant[]);
  await db
    .insert(experimentAssignments)
    .values({ experimentId: exp.id, leadId, variantId: variant.id })
    .onConflictDoNothing();
  return variant.id;
}

/** Records the terminal outcome for a lead's assignment (idempotent-ish). */
export async function recordOutcome(
  db: Db,
  experimentKey: string,
  leadId: number,
  outcome: string,
): Promise<void> {
  const [exp] = await db.select().from(experiments).where(eq(experiments.key, experimentKey)).limit(1);
  if (!exp) return;
  await db
    .update(experimentAssignments)
    .set({ outcome, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(experimentAssignments.experimentId, exp.id),
        eq(experimentAssignments.leadId, leadId),
      ),
    );
}

export type VariantStats = {
  variantId: string;
  label: string;
  isControl: boolean;
  assigned: number;
  outcomes: Record<string, number>;
  conversionRate: number; // share with a "positive" outcome
};

const POSITIVE_OUTCOMES = new Set(["replied", "interested", "whatsapp_handoff", "registered", "active_customer", "generated_customer"]);

export async function analyzeExperiment(db: Db, experimentKey: string) {
  const [exp] = await db.select().from(experiments).where(eq(experiments.key, experimentKey)).limit(1);
  if (!exp) return null;

  const rows = await db
    .select({
      variantId: experimentAssignments.variantId,
      outcome: experimentAssignments.outcome,
      n: sql<number>`count(*)`,
    })
    .from(experimentAssignments)
    .where(eq(experimentAssignments.experimentId, exp.id))
    .groupBy(experimentAssignments.variantId, experimentAssignments.outcome);

  const variants = exp.variants as Variant[];
  const stats: VariantStats[] = variants.map((v) => {
    const mine = rows.filter((r) => r.variantId === v.id);
    const assigned = mine.reduce((s, r) => s + Number(r.n), 0);
    const outcomes: Record<string, number> = {};
    let positive = 0;
    for (const r of mine) {
      if (r.outcome) {
        outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + Number(r.n);
        if (POSITIVE_OUTCOMES.has(r.outcome)) positive += Number(r.n);
      }
    }
    return {
      variantId: v.id,
      label: v.label,
      isControl: v.isControl,
      assigned,
      outcomes,
      conversionRate: assigned > 0 ? positive / assigned : 0,
    };
  });

  const totalAssigned = stats.reduce((s, v) => s + v.assigned, 0);
  const enoughData = totalAssigned >= exp.targetSampleSize;
  const leader = [...stats].sort((a, b) => b.conversionRate - a.conversionRate)[0];

  return {
    key: exp.key,
    variable: exp.variable,
    status: exp.status,
    targetSampleSize: exp.targetSampleSize,
    totalAssigned,
    enoughData,
    // Never declare a winner before the sample target is met.
    suggestedWinner: enoughData && leader && leader.assigned > 0 ? leader.variantId : null,
    stats,
  };
}
