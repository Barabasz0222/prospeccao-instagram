import "@/lib/server-only-shim";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";
import { getSetting, setSetting } from "@/features/settings/repo";
import { log } from "@/lib/logger";

type Db = LibSQLDatabase<typeof schema>;

const GRAPH = "https://graph.instagram.com";
const TOKEN_KEY = "instagram.access_token";
const EXPIRES_KEY = "instagram.token_expires_at";
const BOOTSTRAP_KEY = "instagram.token_bootstrap_from";

const isReal = (t: string | undefined | null) => !!t && t !== "test" && t !== "dev";

/**
 * The live access token. On first run it seeds the settings table from
 * INSTAGRAM_PAGE_ACCESS_TOKEN in .env, then always reads from settings so the
 * auto-refreshed value wins.
 */
export async function getAccessToken(db: Db): Promise<string | null> {
  const envToken = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
  const stored = await getSetting<string | null>(db, TOKEN_KEY, null);

  // Seed once, and re-seed if the operator pasted a new token into .env.
  const bootstrappedFrom = await getSetting<string | null>(db, BOOTSTRAP_KEY, null);
  if (isReal(envToken) && envToken !== bootstrappedFrom && (!stored || bootstrappedFrom !== envToken)) {
    await setSetting(db, TOKEN_KEY, envToken, "bootstrap");
    await setSetting(db, BOOTSTRAP_KEY, envToken, "bootstrap");
    await setSetting(
      db,
      EXPIRES_KEY,
      new Date(Date.now() + 55 * 86_400_000).toISOString(),
      "bootstrap",
    );
    return envToken!;
  }
  return stored ?? (isReal(envToken) ? envToken! : null);
}

/** Days until the stored token expires; null if unknown / no token. */
export async function tokenDaysLeft(db: Db): Promise<number | null> {
  const exp = await getSetting<string | null>(db, EXPIRES_KEY, null);
  if (!exp) return null;
  return (new Date(exp).getTime() - Date.now()) / 86_400_000;
}

/**
 * Exchanges the current long-lived token for a fresh one (valid ~60 days).
 * Instagram allows this once the token is at least 24h old.
 */
export async function refreshAccessToken(db: Db): Promise<{ ok: boolean; reason?: string }> {
  const token = await getAccessToken(db);
  if (!token) return { ok: false, reason: "sem token" };

  try {
    const url = `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };
    if (!res.ok || data.error || !data.access_token) {
      return { ok: false, reason: data.error?.message ?? `HTTP ${res.status}` };
    }
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 5_184_000) * 1000).toISOString();
    await setSetting(db, TOKEN_KEY, data.access_token, "refresh");
    await setSetting(db, EXPIRES_KEY, expiresAt, "refresh");
    log.info("instagram.token_refreshed", { expiresAt });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
