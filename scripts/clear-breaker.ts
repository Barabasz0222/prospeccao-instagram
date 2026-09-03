/**
 * Recupera de uma sessão ruim: apaga as falhas recentes de browser_send_log
 * (as que disparam o circuit breaker), zera o contador de DMs de hoje e
 * despausa o sistema. Não toca em leads nem conversas.
 *
 *   pnpm clear-breaker
 */
import "./_env";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { browserSendLog, sendCounters } from "@/db/schema";
import { resumeSystem } from "@/features/settings/repo";
import { dayKeyInTz } from "@/lib/time";
import { loadEnv } from "@/lib/env";

const db = getDb();
const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

const removed = await db
  .delete(browserSendLog)
  .where(and(eq(browserSendLog.result, "failed"), gte(browserSendLog.createdAt, since)))
  .returning({ id: browserSendLog.id });

// Rebuild today's browser send counter from what was ACTUALLY logged as sent
// (false "sent" from a broken send inflated it).
const today = dayKeyInTz(new Date(), loadEnv().OPERATING_TIMEZONE);
const realSent = await db
  .select({ id: browserSendLog.id })
  .from(browserSendLog)
  .where(and(eq(browserSendLog.result, "sent"), gte(browserSendLog.createdAt, `${today}T00:00:00`)));

await db
  .insert(sendCounters)
  .values({ day: today, channel: "browser", count: realSent.length })
  .onConflictDoUpdate({
    target: [sendCounters.day, sendCounters.channel],
    set: { count: realSent.length, updatedAt: new Date().toISOString() },
  });

await resumeSystem(db, "clear-breaker");

console.log(
  `${removed.length} falhas apagadas. Contador de hoje ajustado para ${realSent.length}. Sistema despausado.`,
);
process.exit(0);
