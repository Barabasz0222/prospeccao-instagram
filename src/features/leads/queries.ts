import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  conversations,
  decisionsLog,
  events,
  leads,
  messages,
  type Lead,
} from "@/db/schema";
import { CUSTOMER_PIPELINE, AFFILIATE_PIPELINE, type Funnel } from "@/lib/states";

export const STAGE_LABELS: Record<string, string> = {
  discovered: "Descoberto",
  qualified: "Qualificado",
  contacted: "Abordado",
  replied: "Respondeu",
  interested: "Interessado",
  whatsapp_handoff: "Encaminhado ao WhatsApp",
  registered: "Cadastrado",
  active_customer: "Cliente ativo",
  joined_affiliate_group: "Entrou no grupo",
  active_affiliate: "Afiliado ativo",
  generated_customer: "Gerou cliente",
  closed: "Encerrado",
};

export const CHANNEL_LABELS: Record<string, string> = {
  browser_contact_pending: "Navegador pendente",
  browser_contact_sent: "Navegador enviado",
  waiting_inbound_reply: "Aguardando resposta",
  api_eligible: "API elegível",
  api_active: "API ativa",
  api_window_closed: "Janela da API fechada",
  human_review_required: "Revisão humana",
  do_not_contact: "Não contatar",
  blocked: "Bloqueado",
  completed: "Concluído",
};

export type KanbanColumn = { stage: string; label: string; leads: Lead[] };

export async function getKanban(funnel: Funnel): Promise<KanbanColumn[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(leads)
    .where(eq(leads.funnel, funnel))
    .orderBy(desc(leads.priority), desc(leads.updatedAt));

  const order = funnel === "customer" ? CUSTOMER_PIPELINE : AFFILIATE_PIPELINE;
  return order.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage] ?? stage,
    leads: rows.filter((r) => r.pipelineStage === stage),
  }));
}

export type TimelineItem = {
  at: string;
  kind: "message" | "event" | "decision";
  title: string;
  detail?: string;
};

export async function getLeadDetail(id: number) {
  const db = getDb();
  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) return null;

  const [conv] = await db.select().from(conversations).where(eq(conversations.leadId, id)).limit(1);
  const msgs = conv
    ? await db.select().from(messages).where(eq(messages.conversationId, conv.id))
    : [];
  const evs = await db.select().from(events).where(eq(events.leadId, id));
  const decs = await db.select().from(decisionsLog).where(eq(decisionsLog.leadId, id));

  const timeline: TimelineItem[] = [
    ...msgs.map((m) => ({
      at: m.sentAt,
      kind: "message" as const,
      title: `${m.direction === "outbound" ? "Nós" : "Lead"} · ${m.channel}`,
      detail: m.body,
    })),
    ...evs.map((e) => ({
      at: e.occurredAt,
      kind: "event" as const,
      title: e.type,
      detail: JSON.stringify(e.data),
    })),
    ...decs.map((d) => ({
      at: d.createdAt,
      kind: "decision" as const,
      title: `Decisão: ${d.decision}`,
      detail: d.rationale ?? undefined,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return { lead, conversation: conv ?? null, timeline };
}
