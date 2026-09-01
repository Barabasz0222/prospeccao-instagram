import { copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { log } from "@/lib/logger";

/**
 * Copies the SQLite file into backups/ with a UTC timestamp and prunes old
 * copies. Safe to call from the worker on a schedule or from `pnpm db:backup`.
 */
export function backupDatabase(databaseUrl = process.env.DATABASE_URL ?? "file:./data/app.db", keep = 14): string | null {
  if (!databaseUrl.startsWith("file:") || databaseUrl.includes(":memory:")) {
    log.warn("backup.skipped", { reason: "DATABASE_URL não é arquivo local" });
    return null;
  }
  const src = databaseUrl.slice("file:".length);
  const dir = "backups";
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(dir, `${basename(src)}.${stamp}.bak`);
  copyFileSync(src, dest);

  const mine = readdirSync(dir)
    .filter((f) => f.startsWith(basename(src)) && f.endsWith(".bak"))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of mine.slice(keep)) {
    try {
      unlinkSync(join(dir, f));
    } catch {
      /* best effort */
    }
  }

  log.info("backup.created", { dest, kept: Math.min(mine.length, keep) });
  return dest;
}
