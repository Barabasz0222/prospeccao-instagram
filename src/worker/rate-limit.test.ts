import { describe, expect, it } from "vitest";
import { makeTestDb } from "@/db/test-helpers";
import { browserSendGate, incrementSendCounter, warmupCap } from "./rate-limit";
import { checkCircuitBreaker } from "./safety";
import { browserSendLog, leads } from "@/db/schema";

describe("warmup schedule", () => {
  it("ramps 5/day in week 1, +5 per week, capped", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    expect(warmupCap(start, new Date("2026-01-03T00:00:00Z"), 30)).toBe(5);
    expect(warmupCap(start, new Date("2026-01-10T00:00:00Z"), 30)).toBe(10);
    expect(warmupCap(start, new Date("2026-06-01T00:00:00Z"), 30)).toBe(30);
  });
});

describe("browserSendGate", () => {
  it("blocks outside operating hours", async () => {
    Object.assign(process.env, { OPERATING_HOURS: "09:00-20:00", OPERATING_TIMEZONE: "UTC" });
    const { db } = await makeTestDb();
    const res = await browserSendGate(db, {
      firstRunAt: new Date(),
      now: new Date("2026-03-10T03:00:00Z"),
    });
    expect(res.allowed).toBe(false);
  });

  it("blocks once the daily cap is reached", async () => {
    Object.assign(process.env, { OPERATING_HOURS: "00:00-23:59", OPERATING_TIMEZONE: "UTC" });
    const { db } = await makeTestDb();
    const now = new Date("2026-03-10T12:00:00Z");
    const firstRunAt = new Date("2025-01-01T00:00:00Z"); // long past warmup
    for (let i = 0; i < 30; i++) await incrementSendCounter(db, "browser", now);
    const res = await browserSendGate(db, { firstRunAt, now });
    expect(res).toMatchObject({ allowed: false });
  });
});

describe("circuit breaker", () => {
  it("trips when the recent failure rate is too high", async () => {
    const { db } = await makeTestDb();
    const [lead] = await db
      .insert(leads)
      .values({ funnel: "customer", igUsername: "x", profileUrl: "https://instagram.com/x" })
      .returning();
    for (let i = 0; i < 6; i++) {
      await db.insert(browserSendLog).values({
        leadId: lead!.id,
        mode: "live",
        body: "m",
        result: i < 4 ? "failed" : "sent",
      });
    }
    const res = await checkCircuitBreaker(db, { minSamples: 5, maxFailureRate: 0.5 });
    expect(res.tripped).toBe(true);
  });
});
