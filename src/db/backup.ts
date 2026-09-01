import "@/lib/dotenv";
import { backupDatabase } from "./backup-runner";

const dest = backupDatabase();
if (!dest) process.exit(1);
console.log(`Backup criado: ${dest}`);
