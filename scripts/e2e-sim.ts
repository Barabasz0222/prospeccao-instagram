/**
 * Fluxo ponta a ponta em modo simulação — sem Chrome real, sem API real.
 * Demonstra: descoberta → dedupe → 1ª DM pelo "navegador" → resposta via
 * "webhook" → handoff de canal → decisão da IA → encaminhamento ao WhatsApp,
 * com trava de envio duplicado e recuperação de job.
 *
 *   pnpm tsx scripts/e2e-sim.ts
 */
Object.assign(process.env, {
  NODE_ENV: "test",
  CLAUDEIA_API_KEY: "offline",
  BROWSER_SEND_MODE: "simulation",
  OPERATING_HOURS: "00:00-23:59",
  OPERATING_TIMEZONE: "UTC",
});

import { eq } from "drizzle-orm";
import { makeTestDb } from "@/db/test-helpers";
import { leads, browserSendLog, messages, decisionsLog } from "@/db/schema";
import { setBrowserDriver, FakeBrowserDriver } from "@/integrations/browser";
import {
  handleDiscoverProfiles,
  handleProcessInbound,
  handleSendFirstDm,
} from "@/worker/handlers";
import { DuplicateSendError, recordOutbound } from "@/features/conversations/repo";
import { enqueue } from "@/worker/queue";

function h(title: string) {
  console.log(`\n=== ${title} ===`);
}

const { db } = await makeTestDb();
const ctx = { db, workerId: "e2e" };
const driver = new FakeBrowserDriver();
setBrowserDriver(driver);

h("1. Descoberta (com duplicata proposital)");
const disc = await handleDiscoverProfiles(ctx, {
  funnel: "customer",
  candidates: [
    {
      igUsername: "construtora.exemplo",
      profileUrl: "https://instagram.com/construtora.exemplo",
      displayName: "Construtora Exemplo",
      bio: "Obras residenciais em Maringá-PR. Orçamento sem compromisso.",
      category: "Serviço de construção",
      location: "Maringá, PR",
      followerCount: 1840,
      sourceKeyword: "sistema para construtora",
    },
    { igUsername: "@Construtora.Exemplo", profileUrl: "https://instagram.com/construtora.exemplo" },
  ],
});
console.log(disc); // { created: 1, duplicate: 1, blocked: 0 }

const [lead] = await db.select().from(leads);
console.log("lead:", { id: lead!.id, stage: lead!.pipelineStage, channel: lead!.channelState });

h("2. Primeira DM pelo navegador (driver falso)");
const dmPayload = {
  leadId: lead!.id,
  message:
    "Oi! Vi que vocês tocam obras residenciais em Maringá. A BraszTech desenvolve sistemas sob medida — tem um SaaS de gestão de obras já em uso real. Posso te mostrar rapidinho?",
  variantId: "opener_v1",
};
const jobId = (await enqueue(db, { kind: "send_first_dm", payload: dmPayload }))!;
const sent = await handleSendFirstDm(ctx, dmPayload, jobId);
console.log(sent);
console.log("DM registrada no navegador:", driver.sent.length === 1);

h("3. Trava de envio duplicado (API tenta antes da resposta)");
try {
  await recordOutbound(db, { leadId: lead!.id, channel: "api", body: "forçando envio" });
  console.log("ERRO: envio duplicado não foi bloqueado");
} catch (e) {
  console.log("bloqueado corretamente:", e instanceof DuplicateSendError);
}

h("4. Lead responde — handoff navegador → webhook → API");
// Vincula o id da Meta ao lead (o webhook real faz isso pelo ig_user_id).
await db.update(leads).set({ igUserId: "meta-user-777" }).where(eq(leads.id, lead!.id));
const inbound = await handleProcessInbound(ctx, {
  metaUserId: "meta-user-777",
  externalId: "mid-abc-1",
  text: "Interessante! Quanto custa esse sistema de gestão de obras?",
  receivedAt: new Date().toISOString(),
});
console.log(inbound);

const [refreshed] = await db.select().from(leads).where(eq(leads.id, lead!.id));
console.log("estado agora:", {
  stage: refreshed!.pipelineStage,
  channel: refreshed!.channelState,
});

h("5. Idempotência do webhook (entrega repetida)");
await handleProcessInbound(ctx, {
  metaUserId: "meta-user-777",
  externalId: "mid-abc-1",
  text: "Interessante! Quanto custa esse sistema de gestão de obras?",
  receivedAt: new Date().toISOString(),
});
const inboundCount = (await db.select().from(messages)).filter((m) => m.direction === "inbound").length;
console.log("mensagens inbound gravadas (esperado 1):", inboundCount);

h("6. Sinal externo: cliente cadastrou e ativou");
const { applyCustomerSignal } = await import("@/features/leads/lifecycle");
const reg = await applyCustomerSignal(db, { type: "registered", leadId: lead!.id });
const act = await applyCustomerSignal(db, { type: "active_customer", leadId: lead!.id });
console.log("registered:", reg, "| active_customer:", act);
const [final] = await db.select().from(leads).where(eq(leads.id, lead!.id));
console.log("etapa final do lead:", final!.pipelineStage);

h("7. Trilha de auditoria");
console.log("browser_send_log:", (await db.select().from(browserSendLog)).map((r) => r.result));
console.log(
  "decisions_log:",
  (await db.select().from(decisionsLog)).map((r) => `${r.decision} — ${r.rationale}`),
);
console.log(
  "mensagens:",
  (await db.select().from(messages)).map((m) => `${m.direction}/${m.channel}: ${m.body.slice(0, 60)}`),
);

h("RESULTADO");
const ok =
  disc.created === 1 &&
  disc.duplicate === 1 &&
  sent && "sent" in sent &&
  inbound.matched === true &&
  refreshed!.channelState === "api_active" &&
  inboundCount === 1 &&
  final!.pipelineStage === "active_customer";
console.log(ok ? "✅ Fluxo ponta a ponta OK" : "❌ Fluxo falhou");
process.exit(ok ? 0 : 1);
