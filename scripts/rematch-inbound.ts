/**
 * Reprocesses every stored webhook event through handleProcessInbound. Safe
 * to run anytime: matched+already-processed events are a no-op (dupe check by
 * externalId), so this only affects replies that previously came back
 * `matched: false` (leads whose first DM went out via the browser, so we
 * never learned their numeric IG id) — now resolvable via @username.
 *
 *   pnpm tsx scripts/rematch-inbound.ts
 */
import "./_env";
import { getDb } from "@/db/client";
import { webhookEvents } from "@/db/schema";
import { handleProcessInbound } from "@/worker/handlers";

const db = getDb();
const ctx = { db, workerId: "rematch-script" };

const rows = await db.select().from(webhookEvents);
console.log(`${rows.length} eventos de webhook armazenados.`);

let matched = 0;
let stillUnmatched = 0;
let already = 0;

for (const row of rows) {
  const p = row.payload as { senderId: string; externalId: string; text: string; timestamp: string };
  const res = await handleProcessInbound(ctx, {
    metaUserId: p.senderId,
    externalId: p.externalId,
    text: p.text,
    receivedAt: p.timestamp,
  });
  if (!res.matched) {
    stillUnmatched++;
    console.log(`  sem lead: meta ${p.senderId} "${p.text.slice(0, 40)}"`);
  } else if ("alreadyProcessed" in res && res.alreadyProcessed) {
    already++;
  } else {
    matched++;
    console.log(`  casado e processado: "${p.text.slice(0, 40)}"`);
  }
}

console.log(`\nresultado: ${matched} casados agora, ${already} já processados, ${stillUnmatched} ainda sem lead.`);
process.exit(0);
