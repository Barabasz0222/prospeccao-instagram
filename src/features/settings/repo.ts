import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { settings } from "@/db/schema";
import * as schema from "@/db/schema";

type Db = LibSQLDatabase<typeof schema>;

export const SETTING_KEYS = {
  systemPaused: "system.paused",
  pauseReason: "system.pause_reason",
} as const;

export async function getSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(
  db: Db,
  key: string,
  value: unknown,
  updatedBy = "operator",
): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updatedBy })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy, updatedAt: new Date().toISOString() } });
}

export async function isSystemPaused(db: Db): Promise<boolean> {
  return getSetting<boolean>(db, SETTING_KEYS.systemPaused, false);
}

/** Global kill switch. Used by the panel button and by automatic safety trips. */
export async function pauseSystem(db: Db, reason: string, by = "operator"): Promise<void> {
  await setSetting(db, SETTING_KEYS.systemPaused, true, by);
  await setSetting(db, SETTING_KEYS.pauseReason, reason, by);
}

export async function resumeSystem(db: Db, by = "operator"): Promise<void> {
  await setSetting(db, SETTING_KEYS.systemPaused, false, by);
  await setSetting(db, SETTING_KEYS.pauseReason, "", by);
}
