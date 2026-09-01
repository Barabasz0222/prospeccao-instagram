import "@/lib/server-only-shim";
import { z } from "zod";
import { complete, isOfflineMode } from "@/integrations/openai/client";
import { assertOutboundText, checkOutboundText } from "@/lib/claims";
import { loadBusiness, type Business } from "@/lib/business";
import { normalize } from "@/lib/text";

export const INTENTS = [
  "interested",
  "asked_info",
  "asked_pricing",
  "wants_whatsapp",
  "not_the_owner",
  "will_forward",
  "objection",
  "not_interested",
  "opt_out",
  "ambiguous",
  "needs_human",
] as const;
export type Intent = (typeof INTENTS)[number];

export const ACTIONS = [
  "reply",
  "ask",
  "present",
  "handle_objection",
  "forward_whatsapp",
  "wait",
  "schedule_followup",
  "close",
  "escalate_human",
] as const;
export type Action = (typeof ACTIONS)[number];

const OPT_OUT_PHRASES = [
  "nao quero",
  "para de",
  "pare de",
  "nao me manda",
  "sai fora",
  "descadastr",
  "remove meu contato",
  "nao tenho interesse e nao quero mais",
  "spam",
];

/** Deterministic opt-out detection runs before any model call. */
export function detectOptOut(text: string): boolean {
  const n = normalize(text);
  return OPT_OUT_PHRASES.some((p) => n.includes(p));
}

const classificationSchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
});

export async function classifyIntent(
  text: string,
  context: { funnel: "customer" | "affiliate"; history: string },
  leadId?: number,
): Promise<{ intent: Intent; confidence: number }> {
  if (detectOptOut(text)) return { intent: "opt_out", confidence: 1 };
  if (isOfflineMode()) return { intent: heuristicIntent(text), confidence: 0.5 };

  const res = await complete({
    purpose: "classify_intent",
    fast: true,
    leadId,
    maxTokens: 120,
    system:
      "Você classifica a intenção da última mensagem de um lead numa conversa de prospecção. " +
      `Responda APENAS com JSON {"intent": <um de ${INTENTS.join("|")}>, "confidence": 0..1}.`,
    messages: [
      {
        role: "user",
        content: `Funil: ${context.funnel}\nHistórico:\n${context.history}\n\nÚltima mensagem do lead:\n${text}`,
      },
    ],
  });

  try {
    const parsed = classificationSchema.parse(JSON.parse(extractJson(res.text)));
    return parsed;
  } catch {
    return { intent: "ambiguous", confidence: 0 };
  }
}

const decisionSchema = z.object({
  action: z.enum(ACTIONS),
  message: z.string().optional(),
  rationale: z.string(),
});

export type Decision = z.infer<typeof decisionSchema>;

export async function decideReply(args: {
  intent: Intent;
  funnel: "customer" | "affiliate";
  history: string;
  profileSummary: string;
  leadId?: number;
}): Promise<Decision> {
  const business = loadBusiness();

  if (args.intent === "opt_out") {
    return { action: "close", rationale: "Lead pediu para parar; entra em do_not_contact." };
  }

  if (isOfflineMode()) {
    const d = offlineDecision(args.intent, args.funnel);
    if (d.message) assertOutboundText(d.message);
    return d;
  }

  const target =
    args.funnel === "customer"
      ? business.links.whatsapp
      : (business.links.affiliateGroup ?? business.links.whatsapp);

  const res = await complete({
    purpose: "decide_reply",
    leadId: args.leadId,
    maxTokens: 500,
    system: [
      `Você é o assistente comercial da ${business.company.name}, representando ${business.owner.name} (${business.owner.role}).`,
      `Pitch: ${business.pitch.oneLine}`,
      "REGRA DE AFIRMAÇÕES: só pode afirmar o que está nesta lista literal de afirmações verificadas:",
      business.verifiedClaims.map((c) => `- ${c}`).join("\n"),
      "Nunca invente taxa, número, garantia, superlativo, relação societária. Nunca prometa aprovação de conta ou resultado financeiro.",
      "A conversa deve parecer pessoal, não campanha. Nunca finja ser cliente.",
      `Quando o lead demonstrar interesse real, encaminhe para: ${target}`,
      `Responda APENAS com JSON {"action": <um de ${ACTIONS.join("|")}>, "message": <texto em pt-BR, opcional>, "rationale": <curto>}.`,
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: `Funil: ${args.funnel}\nIntenção detectada: ${args.intent}\nPerfil do lead: ${args.profileSummary}\nHistórico:\n${args.history}`,
      },
    ],
  });

  let decision: Decision;
  try {
    decision = decisionSchema.parse(JSON.parse(extractJson(res.text)));
  } catch {
    return { action: "escalate_human", rationale: "Não consegui interpretar a decisão do modelo." };
  }

  // Verified-claims gate on any outbound text.
  if (decision.message) {
    const check = checkOutboundText(decision.message);
    if (!check.ok) {
      return {
        action: "escalate_human",
        rationale: `Mensagem gerada violou a regra de afirmações (${check.reason}).`,
      };
    }
    assertOutboundText(decision.message);
  }
  return decision;
}

// ── Offline heuristics (simulation / CI, no LLM) ─────────────────────────────
function heuristicIntent(text: string): Intent {
  const n = normalize(text);
  if (/(preco|valor|quanto custa|mensalidade|orcamento)/.test(n)) return "asked_pricing";
  if (/(whats|whatsapp|zap|chama no)/.test(n)) return "wants_whatsapp";
  if (/(nao sou|falar com o dono|responsavel|gerente)/.test(n)) return "not_the_owner";
  if (/(vou repassar|encaminho|passo pro)/.test(n)) return "will_forward";
  if (/(nao tenho interesse|nao preciso|ja tenho)/.test(n)) return "not_interested";
  if (/(caro|sem tempo|nao sei|depois eu vejo)/.test(n)) return "objection";
  if (/(quero saber|como funciona|me explica|mais informacoes|interesse|gostei)/.test(n))
    return "interested";
  return "ambiguous";
}

function offlineDecision(intent: Intent, funnel: "customer" | "affiliate"): Decision {
  const business = loadBusiness();
  const target =
    funnel === "customer"
      ? business.links.whatsapp
      : (business.links.affiliateGroup ?? business.links.whatsapp);
  switch (intent) {
    case "opt_out":
      return { action: "close", rationale: "Opt-out." };
    case "not_the_owner":
      return {
        action: "ask",
        message: "Sem problema! Você consegue me indicar quem cuida disso aí?",
        rationale: "Pedir contato do decisor.",
      };
    case "wants_whatsapp":
    case "asked_pricing":
    case "interested":
      return {
        action: "forward_whatsapp",
        message: `Show! Consigo te dar os detalhes por aqui: ${target}`,
        rationale: "Lead demonstrou interesse — encaminhar.",
      };
    case "objection":
      return {
        action: "handle_objection",
        message:
          "Entendo. A ideia não é te tomar tempo — em poucos minutos dá pra ver se faz sentido pro seu caso.",
        rationale: "Tratar objeção leve.",
      };
    case "not_interested":
      return { action: "close", rationale: "Sem interesse." };
    case "will_forward":
      return {
        action: "reply",
        message: "Perfeito, obrigado! Fico à disposição se surgir dúvida.",
        rationale: "Agradecer encaminhamento.",
      };
    default:
      return { action: "escalate_human", rationale: "Intenção ambígua — revisão humana." };
  }
}

function extractJson(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start >= 0 && end > start ? s.slice(start, end + 1) : s;
}

// ── Opening message ─────────────────────────────────────────────────────────
export type OpenerInput = {
  funnel: "customer" | "affiliate";
  displayName: string | null;
  igUsername: string;
  bio: string | null;
  category: string | null;
  location: string | null;
  niche: string | null;
  variantId: string;
  leadId?: number;
};

/**
 * Short, personal, true opener grounded in the real profile. Never a campaign
 * blast, never a false claim. Offline mode uses templates; both paths pass the
 * verified-claims guard.
 */
export async function generateOpener(input: OpenerInput): Promise<string> {
  const business = loadBusiness();
  const ref =
    input.niche ??
    input.category ??
    (input.bio ? input.bio.split(/[.·|\n]/)[0]?.trim() ?? null : null);

  const offline = offlineOpener(input, ref, business);
  if (isOfflineMode()) return offline;

  const system = [
    `Você escreve a PRIMEIRA mensagem de prospecção da ${business.company.name}, em nome de ${business.owner.name}.`,
    "Curta (1-3 frases), pessoal, verdadeira, baseada no perfil real. Nada de campanha, nada de emoji em excesso.",
    "PROIBIDO afirmar qualquer coisa fora desta lista literal:",
    business.verifiedClaims.map((c) => `- ${c}`).join("\n"),
    "Nunca prometa aumento de faturamento, redução de custo/tempo, ROI, resultado financeiro, número, taxa, garantia ou superlativo. Não peça dados. Termine com uma pergunta leve.",
    input.funnel === "affiliate"
      ? "Contexto: convite para o programa de afiliados."
      : "Contexto: apresentar a empresa e sondar interesse.",
    "Responda só com o texto da mensagem.",
  ].join("\n");
  const userMsg = `Perfil @${input.igUsername} — nome: ${input.displayName ?? "?"} · bio: ${input.bio ?? "?"} · categoria: ${input.category ?? "?"} · local: ${input.location ?? "?"}`;

  // Up to 2 attempts; the verified-claims guard is the backstop. On repeated
  // violation, fall back to the safe template — never throw, never block the job.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await complete({
      purpose: "generate_opener",
      leadId: input.leadId,
      maxTokens: 220,
      system: attempt === 0 ? system : `${system}\nSua última resposta violou a regra. Reescreva sem nenhuma promessa de resultado.`,
      messages: [{ role: "user", content: userMsg }],
    });
    const text = res.text.trim();
    if (checkOutboundText(text).ok) return text;
  }
  return offline;
}

function offlineOpener(input: OpenerInput, ref: string | null, business: Business): string {
  const who = input.displayName ? input.displayName : `@${input.igUsername}`;
  const place = input.location ? ` em ${input.location.split(",")[0]}` : "";
  if (input.funnel === "affiliate") {
    return `Oi! Acompanho o conteúdo de ${who}${ref ? ` sobre ${ref}` : ""}. Sou da ${business.company.name} — ${business.owner.name}. Temos um programa de afiliados e achei que combinaria com o seu público. Topa eu te explicar como funciona?`;
  }
  return `Oi! Vi o perfil de ${who}${ref ? ` (${ref})` : ""}${place}. Sou ${business.owner.name}, da ${business.company.name} — a gente desenvolve sistemas e automações sob medida, e tem um SaaS de gestão de obras já em uso real. Faz sentido eu te mostrar um caso rápido?`;
}
