/**
 * Reabre leads que foram fechados como "bloqueado" pelo envio da 1ª DM (um bug
 * de seletor fechou leads bons por engano). Volta pra "qualificado" e zera o
 * contador de tentativas. Não toca em quem realmente respondeu ou virou cliente.
 *
 *   pnpm tsx scripts/reopen-blocked.ts
 */
import "./_env";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversations, leads, messages } from "@/db/schema";

const db = getDb();

const RESET = {
  pipelineStage: "qualified" as const,
  channelState: "browser_contact_pending" as const,
  publicSignals: null,
  updatedAt: new Date().toISOString(),
};

// `pnpm reopen-blocked <id>` re-queues one lead whose DM did not really send
// (wipes its stray outbound message + conversation). Otherwise: all leads a
// send bug pushed to 'blocked'/human review that never actually got a reply.
const oneId = Number(process.argv[2]);
let rows;
if (Number.isFinite(oneId)) {
  const [conv] = await db.select().from(conversations).where(eq(conversations.leadId, oneId)).limit(1);
  if (conv) {
    if (conv.lastInboundAt) {
      console.error(`lead ${oneId} já recebeu resposta — não vou reabrir.`);
      process.exit(1);
    }
    await db.delete(messages).where(eq(messages.conversationId, conv.id));
    await db.delete(conversations).where(eq(conversations.id, conv.id));
  }
  rows = await db.update(leads).set(RESET).where(eq(leads.id, oneId)).returning({ id: leads.id, u: leads.igUsername });
} else {
  rows = await db
    .update(leads)
    .set(RESET)
    .where(
      and(
        inArray(leads.channelState, ["blocked", "human_review_required"]),
        inArray(leads.pipelineStage, ["qualified", "contacted", "closed"]),
      ),
    )
    .returning({ id: leads.id, u: leads.igUsername });
}

console.log(`${rows.length} leads reabertos:`, rows.map((r) => r.u).join(", ") || "(nenhum)");
process.exit(0);
