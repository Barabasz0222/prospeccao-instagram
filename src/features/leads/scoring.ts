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

  // Keyword overlap against ICP keywords (partial, accent-insensitive).
  const matchedKeywords: string[] = [];
  for (const kw of business.icp.keywords) {
    const kwn = normalize(kw);
    if (kwn && haystack.includes(kwn)) matchedKeywords.push(kw);
  }
  const keywordScore = Math.min(1, matchedKeywords.length / 2);
  if (matchedKeywords.length) reasons.push(`palavras-chave ICP: ${matchedKeywords.join(", ")}`);

  // Segment token overlap (looser signal).
  const segTokens = new Set<string>();
  for (const seg of business.icp.segments) for (const t of keywordTokens(seg, 4)) segTokens.add(t);
  const hay = keywordTokens(haystack, 4);
  let segHits = 0;
  for (const t of segTokens) if (hay.has(t)) segHits++;
  const segmentScore = Math.min(1, segHits / 4);
  if (segHits) reasons.push(`termos de segmento: ${segHits}`);

  // Geography bonus.
  let geoScore = 0;
  if (lead.location) {
    const loc = normalize(lead.location);
    if (loc.includes(normalize(business.geography.region))) {
      geoScore = 1;
      reasons.push(`região alvo (${business.geography.region})`);
    } else if (loc.includes(normalize(business.geography.country)) || loc.includes("brasil") || loc.includes("br")) {
      geoScore = 0.5;
    }
  }

  const actorType = classifyActor(haystack, lead.funnel);
  reasons.push(`tipo: ${actorType}`);

  const actorWeight =
    { decision_maker: 1, owner: 0.95, store: 0.8, employee: 0.4, creator: 0.2, unknown: 0.6 }[actorType];

  const base = 0.5 * keywordScore + 0.25 * segmentScore + 0.15 * geoScore + 0.1;
  const icpScore = round2(Math.max(0, Math.min(1, base * (0.6 + 0.4 * actorWeight))));

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

/** Priority bucket 0..3 from score + actor, drives queue ordering. */
export function priorityFromScore(score: number, actorType: Lead["actorType"]): number {
  if (score >= 0.75 && (actorType === "decision_maker" || actorType === "owner")) return 3;
  if (score >= 0.6) return 2;
  if (score >= 0.4) return 1;
  return 0;
}
