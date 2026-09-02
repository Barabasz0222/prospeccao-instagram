/**
 * Limpa o circuit breaker: apaga as falhas recentes de browser_send_log (as que
 * fazem o breaker disparar) e despausa o sistema. Não toca em leads, conversas
 * nem no contador diário de DMs.
 *
 *   pnpm clear-breaker
 */
import "./_env";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { browserSendLog } from "@/db/schema";
import { resumeSystem } from "@/features/settings/repo";

const db = getDb();
const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

const removed = await db
  .delete(browserSendLog)
  .where(and(eq(browserSendLog.result, "failed"), gte(browserSendLog.createdAt, since)))
  .returning({ id: browserSendLog.id });

await resumeSystem(db, "clear-breaker");

console.log(`${removed.length} falhas recentes apagadas do browser_send_log. Sistema despausado.`);
process.exit(0);
