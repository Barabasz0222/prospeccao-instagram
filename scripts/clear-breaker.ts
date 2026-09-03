/**
 * Recupera de uma sessão ruim: apaga o log de envios pelo navegador das
 * últimas 6h (o que dispara o circuit breaker E infla o contador), zera o
 * contador de DMs de hoje e despausa o sistema. Não toca em leads nem
 * conversas.
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
  .where(gte(browserSendLog.createdAt, since))
  .returning({ id: browserSendLog.id });

const today = dayKeyInTz(new Date(), loadEnv().OPERATING_TIMEZONE);
await db
  .update(sendCounters)
  .set({ count: 0, updatedAt: new Date().toISOString() })
  .where(and(eq(sendCounters.day, today), eq(sendCounters.channel, "browser")));

await resumeSystem(db, "clear-breaker");

console.log(
  `${removed.length} registros de envio (6h) apagados. Contador de hoje zerado. Sistema despausado.`,
);
process.exit(0);
