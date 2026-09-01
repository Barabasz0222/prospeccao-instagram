import "@/lib/server-only-shim";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { loadEnv } from "@/lib/env";
import * as schema from "./schema";

function fileFromUrl(url: string): string | null {
  if (url.startsWith("file:")) {
    const path = url.slice("file:".length);
    return path.includes(":memory:") ? null : path;
  }
  return null;
}

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (cached) return cached;
  const { DATABASE_URL } = loadEnv();

  const filePath = fileFromUrl(DATABASE_URL);
  if (filePath) mkdirSync(dirname(filePath), { recursive: true });

  const client = createClient({ url: DATABASE_URL });
  // Pragmas for reliability: WAL, foreign keys, busy timeout.
  client.execute("PRAGMA journal_mode = WAL;").catch(() => {});
  client.execute("PRAGMA foreign_keys = ON;").catch(() => {});
  client.execute("PRAGMA busy_timeout = 5000;").catch(() => {});

  cached = drizzle(client, { schema });
  return cached;
}

export { schema };
