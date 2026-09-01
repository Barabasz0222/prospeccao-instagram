import { loadBusiness } from "./business";
import { keywordTokens } from "./text";

/**
 * Verified-claims guard. The AI may only send statements backed by
 * verifiedClaims. Any overlap with unverifiedClaims — even paraphrased — is
 * blocked. Also blocks invented rates, guarantees, superlatives, and promises
 * of account approval or financial results.
 */

const BLOCKED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b\d+\s*%/, reason: "percentual/taxa não verificada" },
  { pattern: /\bgarant(o|ia|imos|ido)\b/i, reason: "garantia" },
  {
    pattern:
      /\b([oa]s?\s+(melhor|maior)(es)?\b|melhor(es)?\s+(do|da|que|em)\b|maior(es)?\s+(do|da|que|em)\b|nº?\s*1\b|número\s+um\b|líder\s+de\s+mercado|imbatível|inigualável)/i,
    reason: "superlativo",
  },
  { pattern: /aprova\S*\s+(\S+\s+){0,3}(conta|cadastro)/i, reason: "promessa de aprovação de conta" },
  { pattern: /\b(lucro|retorno|faturamento|receita)\s+(garantid|de\s+\d)/i, reason: "promessa de resultado financeiro" },
  { pattern: /\bsóci[oa]\b|\bsociedade\b/i, reason: "relação societária não declarada" },
];

/** Share of an unverified claim's keywords present in the text (0..1). */
function overlapRatio(text: string, claim: string): number {
  const t = keywordTokens(text);
  const c = keywordTokens(claim);
  if (c.size === 0) return 0;
  let hit = 0;
  for (const w of c) if (t.has(w)) hit++;
  return hit / c.size;
}

export type ClaimCheck =
  | { ok: true }
  | { ok: false; reason: string; match?: string };

export function checkOutboundText(text: string): ClaimCheck {
  const business = loadBusiness();

  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    const m = text.match(pattern);
    if (m) return { ok: false, reason, match: m[0] };
  }

  for (const claim of business.unverifiedClaims) {
    if (overlapRatio(text, claim) >= 0.6) {
      return { ok: false, reason: "afirmação não verificada (paráfrase)", match: claim };
    }
  }

  return { ok: true };
}

export function assertOutboundText(text: string): void {
  const res = checkOutboundText(text);
  if (!res.ok) {
    throw new Error(
      `Mensagem bloqueada pela regra de afirmações: ${res.reason}` +
        (res.match ? ` (trecho: "${res.match}")` : ""),
    );
  }
}
