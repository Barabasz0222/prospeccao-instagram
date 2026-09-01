/**
 * Per-model USD price per 1M tokens. Used only to estimate cost for the
 * ai_calls ledger and the monthly budget guard — not billing-accurate.
 * Update when prices change.
 */
type Price = { input: number; output: number };

const PRICES: Record<string, Price> = {
  "claude-opus-5": { input: 15, output: 75 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-fable-5": { input: 1, output: 5 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
};

const FALLBACK: Price = { input: 3, output: 15 };

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? FALLBACK;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}
