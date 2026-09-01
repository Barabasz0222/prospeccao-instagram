/**
 * Popula o banco configurado (DATABASE_URL) com um experimento A/B e enfileira
 * jobs de descoberta para os dois funis. O worker (`pnpm dev`) faz o resto:
 * descobre → pontua → qualifica → gera abertura → 1ª DM (em simulação).
 *
 *   pnpm tsx scripts/seed-demo.ts
 */
import "./_env";
import { getDb } from "@/db/client";
import { experiments } from "@/db/schema";
import { enqueue } from "@/worker/queue";

const db = getDb();

await db
  .insert(experiments)
  .values({
    key: "opener_copy_v1",
    variable: "mensagem_de_abertura",
    status: "running",
    targetSampleSize: 120,
    variants: [
      { id: "opener_A", label: "Abertura com caso de uso", weight: 0.5, isControl: true },
      { id: "opener_B", label: "Abertura com pergunta de dor", weight: 0.5, isControl: false },
    ],
  })
  .onConflictDoNothing();

await enqueue(db, {
  kind: "discover_from_keywords",
  payload: {
    funnel: "customer",
    queries: [
      { kind: "keyword", term: "sistema para construtora", limit: 6 },
      { kind: "keyword", term: "gestão de obras", limit: 6 },
    ],
  },
  dedupeKey: "seed:discover:customer",
});

await enqueue(db, {
  kind: "discover_from_keywords",
  payload: {
    funnel: "affiliate",
    queries: [{ kind: "keyword", term: "automação de processos com inteligência artificial", limit: 5 }],
  },
  dedupeKey: "seed:discover:affiliate",
});

console.log("Seed concluído. Rode `pnpm dev` e abra http://localhost:3000");
console.log("O worker vai processar a fila: descoberta → score → qualificação → 1ª DM (simulação).");
process.exit(0);
