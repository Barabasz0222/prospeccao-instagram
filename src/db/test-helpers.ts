import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

/** Fresh in-memory database with all migrations applied. Test use only. */
export async function makeTestDb() {
  const client = createClient({ url: "file::memory:" });
  await client.execute("PRAGMA foreign_keys = ON;");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: join(process.cwd(), "src/db/migrations") });
  return { db, client };
}
