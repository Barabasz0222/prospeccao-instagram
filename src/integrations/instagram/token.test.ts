import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestDb } from "@/db/test-helpers";
import { getSetting } from "@/features/settings/repo";
import { getAccessToken, refreshAccessToken, tokenDaysLeft } from "./token";

beforeEach(() => {
  delete process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
  vi.restoreAllMocks();
});

describe("getAccessToken", () => {
  it("returns null when nothing is configured", async () => {
    const { db } = await makeTestDb();
    expect(await getAccessToken(db)).toBeNull();
  });

  it("seeds settings from .env on first read, then reads from settings", async () => {
    const { db } = await makeTestDb();
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN = "real-token-abc";
    expect(await getAccessToken(db)).toBe("real-token-abc");
    expect(await getSetting(db, "instagram.access_token", null)).toBe("real-token-abc");

    // A later refresh wrote a new value — .env is now stale but settings win.
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN = "real-token-abc";
    const { setSetting } = await import("@/features/settings/repo");
    await setSetting(db, "instagram.access_token", "refreshed-xyz", "refresh");
    expect(await getAccessToken(db)).toBe("refreshed-xyz");
  });

  it("ignores placeholder values", async () => {
    const { db } = await makeTestDb();
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN = "test";
    expect(await getAccessToken(db)).toBeNull();
  });
});

describe("refreshAccessToken", () => {
  it("stores the new token and expiry from the Graph response", async () => {
    const { db } = await makeTestDb();
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN = "old-token";
    await getAccessToken(db); // seed

    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "new-token", expires_in: 5_184_000 }), { status: 200 }),
    );

    const r = await refreshAccessToken(db);
    expect(r.ok).toBe(true);
    expect(await getAccessToken(db)).toBe("new-token");
    const days = await tokenDaysLeft(db);
    expect(days).toBeGreaterThan(55);
  });

  it("reports failure without overwriting the token", async () => {
    const { db } = await makeTestDb();
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN = "old-token";
    await getAccessToken(db);
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "expired" } }), { status: 400 }),
    );
    const r = await refreshAccessToken(db);
    expect(r.ok).toBe(false);
    expect(await getAccessToken(db)).toBe("old-token");
  });
});
