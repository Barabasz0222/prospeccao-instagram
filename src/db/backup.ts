import { copyFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";

/**
 * Copies the SQLite file into backups/ with a UTC timestamp. libsql in WAL
 * mode keeps a consistent main file; a checkpoint before copy is ideal but the
 * simple copy is acceptable for the local MVP.
 */
const url = process.env.DATABASE_URL ?? "file:./data/app.db";
if (!url.startsWith("file:") || url.includes(":memory:")) {
  console.error("DATABASE_URL não é um arquivo local; backup ignorado.");
  process.exit(1);
}

const src = url.slice(5);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("backups", { recursive: true });
const dest = `backups/${basename(src)}.${stamp}.bak`;
copyFileSync(src, dest);
console.log(`Backup criado: ${dest}`);
