/**
 * Apaga o banco local e recria do zero (migrações). Pare o app antes.
 *   pnpm reset
 */
import "./_env";
import { rmSync } from "node:fs";

const url = process.env.DATABASE_URL ?? "file:./data/app.db";
if (!url.startsWith("file:") || url.includes(":memory:")) {
  console.error("DATABASE_URL não é um arquivo local.");
  process.exit(1);
}
const path = url.slice("file:".length);
for (const ext of ["", "-wal", "-shm"]) {
  try {
    rmSync(path + ext, { force: true });
  } catch (e) {
    console.error(`Não consegui apagar ${path + ext}: ${e instanceof Error ? e.message : e}`);
    console.error("Feche o app/worker (pnpm dev) e tente de novo.");
    process.exit(1);
  }
}
console.log("Banco apagado. Rode: pnpm db:migrate");
process.exit(0);
