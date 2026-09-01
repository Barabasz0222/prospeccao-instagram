import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Restores the SQLite file from a backup. With no argument, uses the newest
 * .bak in backups/. Stop the app before running. Returns the path restored from.
 */
export function restoreDatabase(
  databaseUrl = process.env.DATABASE_URL ?? "file:./data/app.db",
  backupPath?: string,
): string {
  if (!databaseUrl.startsWith("file:") || databaseUrl.includes(":memory:")) {
    throw new Error("DATABASE_URL não é um arquivo local");
  }
  const dest = databaseUrl.slice("file:".length);

  let src = backupPath;
  if (!src) {
    const dir = "backups";
    const dbName = basename(dest);
    const candidates = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.startsWith(dbName) && f.endsWith(".bak"))
          .map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
          .sort((a, b) => b.t - a.t)
      : [];
    if (candidates.length === 0) throw new Error("nenhum backup encontrado em backups/");
    src = candidates[0]!.f;
  }
  if (!existsSync(src)) throw new Error(`backup inexistente: ${src}`);

  // Drop stale WAL/SHM so the restored main file is authoritative.
  for (const ext of ["-wal", "-shm"]) {
    const p = dest + ext;
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
  copyFileSync(src, dest);
  return src;
}
