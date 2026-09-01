/**
 * Restaura o banco a partir de um backup. Pare o app antes.
 *   pnpm tsx scripts/restore-backup.ts                # usa o backup mais recente
 *   pnpm tsx scripts/restore-backup.ts backups/app.db.2026-....bak
 */
import "./_env";
import { restoreDatabase } from "@/db/restore";

const from = restoreDatabase(process.env.DATABASE_URL, process.argv[2]);
console.log(`Banco restaurado a partir de: ${from}`);
process.exit(0);
