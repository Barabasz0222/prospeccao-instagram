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
