import "@/lib/server-only-shim";
import { z } from "zod";
import { complete, isOfflineMode } from "@/integrations/openai/client";
import { assertOutboundText, checkOutboundText } from "@/lib/claims";
import { loadBusiness, type Business } from "@/lib/business";
import { normalize, stripDashes } from "@/lib/text";

// Anything "obra"-related → lead with CronoObra instead of the generic pitch.
const CONSTRUCTION_SIGNALS = [
  "obra", "obras", "construtora", "construcao", "construcoes", "engenharia civil",
  "eng civil", "engenheiro civil", "arquitet", "reforma", "empreiteira",
  "incorporadora", "gestao de obras", "materiais de construcao", "marcenaria",
  "serralheria", "pintura predial", "gesso", "drywall", "canteiro de obras",
];

export function isConstructionLead(input: {
  bio: string | null;
  category: string | null;
  displayName: string | null;
  niche: string | null;
  sourceKeyword?: string | null;
}): boolean {
  const hay = normalize(
    [input.sourceKeyword, input.bio, input.category, input.displayName, input.niche]
      .filter(Boolean)
      .join(" "),
  );
  return CONSTRUCTION_SIGNALS.some((s) => hay.includes(s));
}

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
  isConstruction?: boolean;
  leadId?: number;
}): Promise<Decision> {
  const business = loadBusiness();

  if (args.intent === "opt_out") {
    return { action: "close", rationale: "Lead pediu para parar; entra em do_not_contact." };
  }

  if (isOfflineMode()) {
    const d = offlineDecision(args.intent, args.funnel, !!args.isConstruction);
    if (d.message) {
      d.message = stripDashes(d.message);
      assertOutboundText(d.message);
    }
    return d;
  }

  const cronoobra = (business.links.cronoobra ?? "").replace(/^https?:\/\/(www\.)?/, "");
  const target =
    args.funnel !== "customer"
      ? (business.links.affiliateGroup ?? business.links.whatsapp)
      : args.isConstruction && cronoobra
        ? `${cronoobra} (teste grátis da primeira obra) e o WhatsApp ${business.links.whatsapp} para dúvidas`
        : business.links.whatsapp;

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
      "NUNCA use travessão (— ou –). Separe ideias com ponto ou vírgula, como no WhatsApp.",
      args.isConstruction
        ? `Este lead trabalha com obra. Priorize o CronoObra. Quando demonstrar interesse, encaminhe para: ${target}`
        : `Quando o lead demonstrar interesse real, encaminhe para: ${target}`,
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

  if (decision.message) {
    decision.message = stripDashes(decision.message);
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

function offlineDecision(
  intent: Intent,
  funnel: "customer" | "affiliate",
  construction: boolean,
): Decision {
  const business = loadBusiness();
  const cronoobra = (business.links.cronoobra ?? "").replace(/^https?:\/\/(www\.)?/, "");
  const target =
    funnel !== "customer"
      ? (business.links.affiliateGroup ?? business.links.whatsapp)
      : construction && cronoobra
        ? `${cronoobra}, e me chama no WhatsApp se tiver dúvida: ${business.links.whatsapp}`
        : business.links.whatsapp;
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
        message: construction
          ? `Show! Dá pra testar de graça a primeira obra em ${target}`
          : `Show! Consigo te dar os detalhes por aqui: ${target}`,
        rationale: "Lead demonstrou interesse, encaminhar.",
      };
    case "objection":
      return {
        action: "handle_objection",
        message:
          "Entendo. A ideia não é te tomar tempo, em poucos minutos dá pra ver se faz sentido pro seu caso.",
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
  sourceKeyword?: string | null;
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

  const construction = input.funnel === "customer" && isConstructionLead(input);
  const offline = offlineOpener(input, ref, business, construction);
  if (isOfflineMode()) return offline;

  // A/B: two opener styles the experiment compares.
  const angle =
    input.variantId === "opener_B"
      ? "Abordagem B: comece com uma pergunta leve e curiosa sobre o dia a dia dele (ex: como costuma organizar agenda ou orçamento). NÃO afirme que ele faz no manual, NÃO diga 'imagino que'. Só pergunte."
      : "Abordagem A: comece com um elogio curto e concreto a algo do perfil, depois uma frase apresentando a BraszTech.";

  const pitch = construction
    ? `Este lead trabalha com obra. Cite o CronoObra em uma frase: sistema de cronograma, faturamento e financeiro de obra, primeira obra gratuita para testar em ${business.links.cronoobra ?? "cronoobra.com.br"}.`
    : "Apresente em uma frase que a BraszTech cria sistema e automação sob medida para tirar tarefa manual da rotina.";

  const firstName = business.owner.name.split(/\s+/)[0];
  const system = [
    `Você é ${business.owner.name} escrevendo pessoalmente a PRIMEIRA mensagem no direct do Instagram para um possível cliente da ${business.company.name}.`,
    `Fale na primeira pessoa. Apresente-se como "Sou o ${firstName}, da ${business.company.name}" (uma pessoa falando, não a empresa).`,
    "REGRA DE TAMANHO: no máximo 3 frases e no máximo 320 caracteres no total. Se passar disso, corte.",
    "Tom de mensagem de WhatsApp entre conhecidos. Sem parecer vendedor. Sem emoji. Sem travessão (— ou –), use ponto ou vírgula.",
    "Não diga que a rotina dele é manual nem 'imagino que'. Não use jargão. Não peça dados.",
    "PROIBIDO afirmar qualquer coisa fora desta lista literal:",
    business.verifiedClaims.map((c) => `- ${c}`).join("\n"),
    "Nunca prometa faturamento, economia de custo ou tempo, ROI, número, taxa, garantia ou superlativo.",
    "Termine com uma pergunta curta e leve.",
    input.funnel === "affiliate" ? "Contexto: convite para o programa de afiliados." : `${angle}\n${pitch}`,
    "Responda só com o texto da mensagem, nada mais.",
  ].join("\n");
  const userMsg = `Perfil @${input.igUsername}. nome: ${input.displayName ?? "?"}. bio: ${input.bio ?? "?"}. categoria: ${input.category ?? "?"}. local: ${input.location ?? "?"}`;

  // Up to 3 attempts; the verified-claims guard and the length cap are the
  // backstop. On repeated failure, fall back to the safe template.
  const MAX_LEN = 340;
  for (let attempt = 0; attempt < 3; attempt++) {
    const nudge =
      attempt === 0
        ? ""
        : `\nSua resposta anterior foi rejeitada (${attempt === 1 ? "regra de afirmação ou tamanho" : "ainda fora das regras"}). Reescreva em no máximo 2 frases curtas, sem promessa de resultado, sem travessão.`;
    const res = await complete({
      purpose: "generate_opener",
      leadId: input.leadId,
      maxTokens: 180,
      system: system + nudge,
      messages: [{ role: "user", content: userMsg }],
    });
    const text = stripDashes(res.text.trim());
    if (text.length <= MAX_LEN && checkOutboundText(text).ok) return text;
  }
  return offline;
}

function offlineOpener(
  input: OpenerInput,
  ref: string | null,
  business: Business,
  construction: boolean,
): string {
  const who = input.displayName ? input.displayName : `@${input.igUsername}`;
  const place = input.location ? ` em ${input.location.split(",")[0]}` : "";
  const seg = ref ? ` (${ref})` : "";

  const me = `${business.owner.name.split(/\s+/)[0]}, da ${business.company.name}`;

  if (input.funnel === "affiliate") {
    return stripDashes(
      `Oi! Acompanho o conteúdo de ${who}${ref ? ` sobre ${ref}` : ""}. Sou o ${me}, temos um programa de afiliados que pode combinar com seu público. Posso te explicar como funciona?`,
    );
  }

  if (construction) {
    const site = (business.links.cronoobra ?? "cronoobra.com.br").replace(/^https?:\/\/(www\.)?/, "");
    return stripDashes(
      `Oi! Vi que a ${who} trabalha com obra${place}. Sou o ${me}, temos o CronoObra pra cronograma, faturamento e financeiro de obra, a primeira obra é gratuita pra testar em ${site}. Faz sentido dar uma olhada?`,
    );
  }

  if (input.variantId === "opener_B") {
    return stripDashes(
      `Oi${who ? `, ${who}` : ""}! Como vocês costumam organizar agenda e orçamento hoje em dia? Pergunto porque sou o ${me}, a gente cria sistema e automação sob medida pra esse tipo de coisa. Vale uma conversa rápida?`,
    );
  }
  return stripDashes(
    `Oi! Vi o perfil de ${who}${seg}${place}. Sou o ${me}, a gente cria sistema e automação sob medida pra tirar tarefa manual da rotina. Faz sentido eu te mostrar um exemplo pro seu caso?`,
  );
}
