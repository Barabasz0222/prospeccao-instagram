import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { integrationAlerts } from "@/db/schema";
import * as schema from "@/db/schema";
import { pauseSystem } from "@/features/settings/repo";
import { log } from "@/lib/logger";

type Db = LibSQLDatabase<typeof schema>;

/**
 * Circuit breaker: trips (and pauses the whole system) when the recent failure
 * rate crosses a threshold. Checked before each browser job.
 */
export async function checkCircuitBreaker(
  db: Db,
  opts: { windowMinutes?: number; minSamples?: number; maxFailureRate?: number } = {},
): Promise<{ tripped: boolean; reason?: string }> {
  const windowMinutes = opts.windowMinutes ?? 60;
  const minSamples = opts.minSamples ?? 5;
  const maxFailureRate = opts.maxFailureRate ?? 0.5;

  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      failed: sql<number>`sum(case when result = 'failed' then 1 else 0 end)`,
    })
    .from(schema.browserSendLog)
    .where(sql`created_at >= datetime('now', ${"-" + windowMinutes + " minutes"})`);

  const total = Number(row?.total ?? 0);
  const failed = Number(row?.failed ?? 0);
  if (total < minSamples) return { tripped: false };

  const rate = failed / total;
  if (rate >= maxFailureRate) {
    return { tripped: true, reason: `taxa de falha ${(rate * 100).toFixed(0)}% em ${windowMinutes}min` };
  }
  return { tripped: false };
}

export async function raiseAlert(
  db: Db,
  source: string,
  severity: "info" | "warning" | "critical",
  message: string,
): Promise<void> {
  await db.insert(integrationAlerts).values({ source, severity, message });
  log[severity === "critical" ? "error" : "warn"]("integration.alert", { source, severity, message });
}

/** Trips the breaker: records a critical alert and pauses the system. */
export async function tripAndPause(db: Db, source: string, reason: string): Promise<void> {
  await raiseAlert(db, source, "critical", reason);
  await pauseSystem(db, `${source}: ${reason}`, "circuit_breaker");
}
