/**
 * Cria o experimento A/B da mensagem de abertura. A descoberta de leads é
 * automática (o worker roda a cada X horas a partir do config/business.json) —
 * não precisa enfileirar nada aqui.
 *
 *   pnpm seed
 */
import "./_env";
import { getDb } from "@/db/client";
import { experiments } from "@/db/schema";

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

console.log("Experimento A/B criado. Rode `pnpm dev` — a descoberta começa sozinha.");
process.exit(0);
