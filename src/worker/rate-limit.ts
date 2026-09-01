import { and, eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { sendCounters } from "@/db/schema";
import * as schema from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { dayKeyInTz, isWithinOperatingHours } from "@/lib/time";

type Db = LibSQLDatabase<typeof schema>;

/** Warmup: 5/day in week 1, +5 each subsequent week, capped at MAX_DMS_PER_DAY. */
export function warmupCap(firstRunAt: Date, now: Date, hardCap: number): number {
  const weeks = Math.floor((now.getTime() - firstRunAt.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return Math.min(hardCap, 5 * (weeks + 1));
}

export type GateResult = { allowed: boolean; reason?: string; remaining?: number };

export async function browserSendGate(
  db: Db,
  opts: { firstRunAt: Date; now?: Date },
): Promise<GateResult> {
  const env = loadEnv();
  const now = opts.now ?? new Date();

  if (!isWithinOperatingHours(now, env.OPERATING_HOURS, env.OPERATING_TIMEZONE)) {
    return { allowed: false, reason: "fora da janela de operação" };
  }

  const day = dayKeyInTz(now, env.OPERATING_TIMEZONE);
  const [row] = await db
    .select()
    .from(sendCounters)
    .where(and(eq(sendCounters.day, day), eq(sendCounters.channel, "browser")))
    .limit(1);
  const used = row?.count ?? 0;
  const cap = warmupCap(opts.firstRunAt, now, env.MAX_DMS_PER_DAY);

  if (used >= cap) {
    return { allowed: false, reason: `limite diário atingido (${used}/${cap})`, remaining: 0 };
  }
  return { allowed: true, remaining: cap - used };
}

export async function incrementSendCounter(
  db: Db,
  channel: "browser" | "api",
  now = new Date(),
): Promise<void> {
  const env = loadEnv();
  const day = dayKeyInTz(now, env.OPERATING_TIMEZONE);
  await db
    .insert(sendCounters)
    .values({ day, channel, count: 1 })
    .onConflictDoUpdate({
      target: [sendCounters.day, sendCounters.channel],
      set: { count: sql`${sendCounters.count} + 1`, updatedAt: new Date().toISOString() },
    });
}
