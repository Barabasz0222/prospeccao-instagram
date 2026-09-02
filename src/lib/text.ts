/** Accent-insensitive normalization shared by matching helpers. */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function keywordTokens(s: string, minLen = 3): Set<string> {
  return new Set(normalize(s).split(" ").filter((w) => w.length > minLen));
}

/**
 * Removes the em/en dash and the spaced hyphen used as a sentence break — they
 * read as machine-written. Keeps hyphens inside words and URLs (guarda-chuva,
 * wa.me links, CRECI J-4111).
 */
export function stripDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/(\S)\s+-\s+(\S)/g, "$1, $2")
    .replace(/,\s*,/g, ",")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
