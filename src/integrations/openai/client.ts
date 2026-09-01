import "@/lib/server-only-shim";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aiCalls } from "@/db/schema";
import { loadEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { estimateCostUsd } from "./pricing";

export class BudgetExceededError extends Error {}

/**
 * Offline mode: no real LLM calls. Enabled when CLAUDEIA_API_KEY is unset or
 * the sentinel "offline". Used for simulation runs and CI without credentials.
 */
export function isOfflineMode(): boolean {
  const key = process.env.CLAUDEIA_API_KEY;
  return !key || key === "offline" || key === "test";
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: loadEnv().CLAUDEIA_API_KEY });
  return client;
}

/** Current-month spend from the ledger (UTC month). */
export async function monthlySpendUsd(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${aiCalls.estimatedCostUsd}), 0)` })
    .from(aiCalls)
    .where(sql`strftime('%Y-%m', ${aiCalls.createdAt}) = strftime('%Y-%m', 'now')`);
  return Number(row?.total ?? 0);
}

export async function assertBudgetAvailable(): Promise<void> {
  const { CLAUDEIA_MONTHLY_BUDGET_USD } = loadEnv();
  const spent = await monthlySpendUsd();
  if (spent >= CLAUDEIA_MONTHLY_BUDGET_USD) {
    throw new BudgetExceededError(
      `Orçamento mensal de IA atingido: US$ ${spent.toFixed(2)} / US$ ${CLAUDEIA_MONTHLY_BUDGET_USD}`,
    );
  }
}

export type CompleteArgs = {
  purpose: string;
  system: string;
  messages: Anthropic.MessageParam[];
  fast?: boolean;
  maxTokens?: number;
  leadId?: number;
};

export type CompleteResult = { text: string; model: string; costUsd: number };

/**
 * Single entry point for every LLM call. Checks the budget first, then records
 * model, tokens and estimated cost in ai_calls.
 */
export async function complete(args: CompleteArgs): Promise<CompleteResult> {
  await assertBudgetAvailable();
  const env = loadEnv();
  const model = args.fast ? env.CLAUDEIA_MODEL_FAST : env.CLAUDEIA_MODEL;

  const res = await getClient().messages.create({
    model,
    max_tokens: args.maxTokens ?? 600,
    system: args.system,
    messages: args.messages,
  });

  const inputTokens = res.usage.input_tokens;
  const outputTokens = res.usage.output_tokens;
  const costUsd = estimateCostUsd(model, inputTokens, outputTokens);

  await getDb().insert(aiCalls).values({
    leadId: args.leadId,
    purpose: args.purpose,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: costUsd,
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  log.info("ai.call", { purpose: args.purpose, model, inputTokens, outputTokens, costUsd });
  return { text, model, costUsd };
}
