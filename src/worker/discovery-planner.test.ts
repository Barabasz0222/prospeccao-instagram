import { beforeAll, describe, expect, it } from "vitest";
import { makeTestDb } from "@/db/test-helpers";
import { loadBusiness } from "@/lib/business";
import { enqueueDiscoveryRun, planQueries, toHashtag } from "./discovery-planner";
import { claimNext } from "./queue";

beforeAll(() => {
  Object.assign(process.env, { CLAUDEIA_API_KEY: "offline", BROWSER_SEND_MODE: "simulation" });
});

describe("toHashtag", () => {
  it("strips accents and spaces", () => {
    expect(toHashtag("gestão de obras")).toBe("gestaodeobras");
    expect(toHashtag("automação de processos com IA")).toBe("automacaodeprocessoscomia");
  });
});

describe("planQueries", () => {
  it("produces a hashtag + keyword query per term", () => {
    const q = planQueries(["gestão de obras"], 8);
    expect(q).toEqual([
      { kind: "hashtag", term: "gestaodeobras", limit: 8 },
      { kind: "keyword", term: "gestão de obras", limit: 8 },
    ]);
  });
});

describe("enqueueDiscoveryRun", () => {
  it("enqueues one customer + one affiliate discovery job, idempotent per hour", async () => {
    const { db } = await makeTestDb();
    const business = loadBusiness();
    const first = await enqueueDiscoveryRun(db, business);
    expect(first).toBe(2);
    const second = await enqueueDiscoveryRun(db, business);
    expect(second).toBe(0); // same hour bucket → deduped

    const j1 = await claimNext(db, "w");
    expect(j1?.kind).toBe("discover_from_keywords");
    const payload = j1!.payload as { funnel: string; queries: unknown[] };
    expect(["customer", "affiliate"]).toContain(payload.funnel);
    expect(payload.queries.length).toBeGreaterThan(0);
  });
});
