/**
 * Reabre leads que foram fechados como "bloqueado" pelo envio da 1ª DM (um bug
 * de seletor fechou leads bons por engano). Volta pra "qualificado" e zera o
 * contador de tentativas. Não toca em quem realmente respondeu ou virou cliente.
 *
 *   pnpm tsx scripts/reopen-blocked.ts
 */
import "./_env";
import { and, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { leads } from "@/db/schema";

const db = getDb();

// Only leads that never got past the first-DM stage (a send bug pushed them to
// 'blocked'+closed or to human review). Leads that actually replied keep their
// state.
const rows = await db
  .update(leads)
  .set({
    pipelineStage: "qualified",
    channelState: "browser_contact_pending",
    publicSignals: null,
    updatedAt: new Date().toISOString(),
  })
  .where(
    and(
      inArray(leads.channelState, ["blocked", "human_review_required"]),
      inArray(leads.pipelineStage, ["qualified", "contacted", "closed"]),
    ),
  )
  .returning({ id: leads.id, u: leads.igUsername });

console.log(`${rows.length} leads reabertos:`, rows.map((r) => r.u).join(", ") || "(nenhum)");
process.exit(0);
