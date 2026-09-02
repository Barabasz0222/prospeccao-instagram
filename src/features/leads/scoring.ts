import type { Business } from "@/lib/business";
import { keywordTokens, normalize } from "@/lib/text";
import type { Lead } from "@/db/schema";

export type ScoreResult = {
  icpScore: number; // 0..1
  actorType: Lead["actorType"];
  niche: string | null;
  matchedKeywords: string[];
  reasons: string[];
};

const OWNER_HINTS = ["ceo", "founder", "fundador", "socio", "sócio", "dono", "proprietario", "diretor", "gerente", "head "];
const DECISION_HINTS = ["gestor", "coordenador", "responsavel", "responsável", "gerente de", "diretor de"];
const EMPLOYEE_HINTS = ["colaborador", "funcionario", "funcionário", "equipe", "time "];
const STORE_HINTS = ["loja", "atacado", "varejo", "empresa", "ltda", "me ", "eireli", "cnpj", "orcamento", "orçamento", "atendimento", "horario de funcionamento"];
const CREATOR_HINTS = ["criador de conteudo", "creator", "influencer", "digital creator", "podcast", "canal", "newsletter"];

// Bio phrases that suggest a manual, systemless operation — the real BraszTech
// buyer. Boost these; they separate a target from a generic listing.
const PAIN_SIGNALS = [
  "orcamento pelo whatsapp", "orcamento sem compromisso", "agende seu horario",
  "agende pelo whatsapp", "agendamento pelo whatsapp", "chame no whatsapp",
  "atendimento pelo whatsapp", "faca seu orcamento", "solicite um orcamento",
  "marque sua consulta", "agende sua avaliacao", "consultas com hora marcada",
  "atendimento com hora marcada", "planilha", "controle manual", "sob demanda",
  "trabalhamos com agenda", "reservas pelo direct", "pedidos pelo direct",
  "encomendas pelo whatsapp", "delivery pelo whatsapp",
];

// Bio phrases that mean this account SELLS software/automation — a peer, not a
// client. Penalize; the funnel is not for competitors.
const VENDOR_SIGNALS = [
  "automacao de processos", "automacao comercial", "agencia de automacao",
  "criamos sistemas", "desenvolvimento de sistemas", "software house",
  "criacao de sites", "agencia de marketing", "trafego pago", "consultoria de ia",
  "agentes de ia", "chatbot", "crm", "no-code", "low-code", "saas", "startup de tecnologia",
];

function countHits(haystack: string, phrases: string[]): string[] {
  return phrases.filter((p) => haystack.includes(p));
}

/** Deterministic ICP fit + actor classification from public profile signals. */
export function scoreLead(lead: Lead, business: Business): ScoreResult {
  return lead.funnel === "affiliate"
    ? scoreAffiliate(lead, business)
    : scoreCustomer(lead, business);
}

function scoreCustomer(lead: Lead, business: Business): ScoreResult {
  const haystack = normalize(
    [lead.displayName, lead.bio, lead.category, lead.niche, lead.location].filter(Boolean).join(" · "),
  );
  const reasons: string[] = [];

  // Keyword fit: exact phrase = full point; partial token coverage = half.
  const matchedKeywords: string[] = [];
  const hayTokens = keywordTokens(haystack, 3);
  let kwPoints = 0;
  for (const kw of business.icp.keywords) {
    const kwn = normalize(kw);
    const toks = [...keywordTokens(kw, 3)];
    if (kwn && haystack.includes(kwn)) {
      matchedKeywords.push(kw);
      kwPoints += 1;
    } else if (toks.length > 0) {
      const present = toks.filter((t) => hayTokens.has(t)).length;
      if (present === toks.length) {
        matchedKeywords.push(kw);
        kwPoints += 1;
      } else if (present > 0) {
        kwPoints += (present / toks.length) * 0.5;
      }
    }
  }
  const keywordScore = Math.min(1, kwPoints / 2);
  if (matchedKeywords.length) reasons.push(`palavras-chave ICP: ${matchedKeywords.join(", ")}`);

  // Segment token overlap (looser signal).
  const segTokens = new Set<string>();
  for (const seg of business.icp.segments) for (const t of keywordTokens(seg, 4)) segTokens.add(t);
  const hay = keywordTokens(haystack, 4);
  let segHits = 0;
  for (const t of segTokens) if (hay.has(t)) segHits++;
  const segmentScore = Math.min(1, segHits / 4);
  if (segHits) reasons.push(`termos de segmento: ${segHits}`);

  const geoScore = geoFit(lead.location, business, reasons);

  const actorType = classifyActor(haystack, lead.funnel);
  reasons.push(`tipo: ${actorType}`);

  const actorWeight =
    { decision_maker: 1, owner: 0.95, store: 0.8, employee: 0.4, creator: 0.2, unknown: 0.6 }[actorType];

  // Manual-operation vs software-vendor signals.
  const pain = countHits(haystack, PAIN_SIGNALS);
  const vendor = countHits(haystack, VENDOR_SIGNALS);
  const painBonus = Math.min(0.2, pain.length * 0.1);
  const vendorPenalty = Math.min(0.5, vendor.length * 0.25);
  if (pain.length) reasons.push(`sinais de operação manual: ${pain.length}`);
  if (vendor.length) reasons.push(`sinais de fornecedor de software: ${vendor.length} (penalizado)`);

  // The lead was found by searching sourceKeyword; if that term also shows up
  // in their name/bio, they clearly ARE that kind of business — a real local
  // company even when the bio is pure brand fluff with no pain wording.
  let confirmBonus = 0;
  if (lead.sourceKeyword) {
    const kwToks = [...keywordTokens(lead.sourceKeyword, 3)];
    if (kwToks.length > 0 && kwToks.every((t) => hayTokens.has(t))) {
      confirmBonus = 0.12;
      reasons.push(`confirma o ramo buscado (${lead.sourceKeyword})`);
    }
  }

  // Audience sanity: a local SMB that needs a custom system is rarely a
  // 100k+ account — that size is media / infoproduct / influencer territory.
  const f = lead.followerCount ?? 0;
  let audiencePenalty = 0;
  if (f >= 500_000) audiencePenalty = 0.4;
  else if (f >= 150_000) audiencePenalty = 0.25;
  else if (f >= 60_000) audiencePenalty = 0.1;
  if (audiencePenalty > 0) reasons.push(`audiência ${f} (grande demais p/ PME — penalizado)`);

  const base = 0.5 * keywordScore + 0.25 * segmentScore + 0.1 * geoScore + 0.1;
  let icpScore =
    base * (0.6 + 0.4 * actorWeight) + painBonus + confirmBonus - vendorPenalty - audiencePenalty;
  icpScore = round2(Math.max(0, Math.min(1, icpScore)));

  return {
    icpScore,
    actorType,
    niche: lead.niche ?? matchedKeywords[0] ?? null,
    matchedKeywords,
    reasons,
  };
}

/**
 * Affiliate fit: thematic relevance to affiliateTopics, geography, a real
 * creator profile, and an audience size in a workable band (not tiny, not a
 * mega-account whose audience rarely converts to niche B2B).
 */
function scoreAffiliate(lead: Lead, business: Business): ScoreResult {
  const haystack = normalize(
    [lead.displayName, lead.bio, lead.category, lead.niche].filter(Boolean).join(" · "),
  );
  const reasons: string[] = [];

  const topicTokens = new Set<string>();
  for (const t of business.affiliateTopics) for (const w of keywordTokens(t, 4)) topicTokens.add(w);
  const hay = keywordTokens(haystack, 4);
  let topicHits = 0;
  for (const w of topicTokens) if (hay.has(w)) topicHits++;
  const topicScore = Math.min(1, topicHits / 3);
  if (topicHits) reasons.push(`temas de afiliado: ${topicHits}`);

  const actorType = classifyActor(haystack, "affiliate");
  const isCreator = actorType === "creator";
  if (isCreator) reasons.push("perfil de criador");

  let audienceScore = 0.4;
  const f = lead.followerCount ?? 0;
  if (f >= 2_000 && f <= 150_000) {
    audienceScore = 1;
    reasons.push(`audiência ${f} (faixa boa)`);
  } else if (f > 150_000) {
    audienceScore = 0.55;
    reasons.push(`audiência ${f} (grande demais p/ nicho)`);
  } else if (f > 0) {
    audienceScore = 0.3;
    reasons.push(`audiência ${f} (pequena)`);
  }

  let geoScore = 0.5;
  if (lead.location) {
    const loc = normalize(lead.location);
    if (loc.includes(normalize(business.geography.region))) geoScore = 1;
    else if (loc.includes(normalize(business.geography.country)) || loc.includes("brasil")) geoScore = 0.8;
  }

  const base = 0.45 * topicScore + 0.3 * audienceScore + 0.15 * geoScore + 0.1;
  const icpScore = round2(Math.max(0, Math.min(1, base * (isCreator ? 1 : 0.7))));

  return {
    icpScore,
    actorType,
    niche: lead.niche ?? business.affiliateTopics[0] ?? null,
    matchedKeywords: [],
    reasons,
  };
}

function classifyActor(haystack: string, funnel: Lead["funnel"]): Lead["actorType"] {
  const has = (list: string[]) => list.some((h) => haystack.includes(h));
  if (funnel === "affiliate" && has(CREATOR_HINTS)) return "creator";
  if (has(DECISION_HINTS)) return "decision_maker";
  if (has(OWNER_HINTS)) return "owner";
  if (has(EMPLOYEE_HINTS)) return "employee";
  if (has(CREATOR_HINTS)) return "creator";
  if (has(STORE_HINTS)) return "store";
  return "unknown";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const BR_STATES = new Set([
  "ac","al","ap","am","ba","ce","df","es","go","ma","mt","ms","mg","pa","pb",
  "pr","pe","pi","rj","rn","rs","ro","rr","sc","sp","se","to",
  "acre","alagoas","amapa","amazonas","bahia","ceara","distrito federal",
  "espirito santo","goias","maranhao","mato grosso","mato grosso do sul",
  "minas gerais","para","paraiba","parana","pernambuco","piaui","rio de janeiro",
  "rio grande do norte","rio grande do sul","rondonia","roraima","santa catarina",
  "sao paulo","sergipe","tocantins",
]);

/** Geography fit 0..1. Region match is best; any recognizably-BR location is
 *  a solid signal when the ICP targets Brazil. */
function geoFit(
  location: string | null,
  business: Business,
  reasons: string[],
): number {
  if (!location) return 0.3; // unknown — mild neutral, not a penalty
  const loc = normalize(location);
  const region = normalize(business.geography.region);
  const country = normalize(business.geography.country);

  if (region && region !== country && loc.includes(region)) {
    reasons.push(`região alvo (${business.geography.region})`);
    return 1;
  }
  const looksBr =
    loc.includes("brasil") ||
    loc.includes(country) ||
    loc.split(/[\s,/-]+/).some((tok) => BR_STATES.has(tok));
  if (looksBr) {
    reasons.push("localização no Brasil");
    return 0.8;
  }
  return 0.1;
}

/** Priority bucket 0..3 from score + actor, drives queue ordering. */
export function priorityFromScore(score: number, actorType: Lead["actorType"]): number {
  if (score >= 0.75 && (actorType === "decision_maker" || actorType === "owner")) return 3;
  if (score >= 0.6) return 2;
  if (score >= 0.4) return 1;
  return 0;
}
