import { describe, expect, it } from "vitest";
import { makeTestDb } from "@/db/test-helpers";
import { experiments, leads } from "@/db/schema";
import { analyzeExperiment, assignVariant, pickVariant, recordOutcome } from "./repo";

const VARIANTS = [
  { id: "A", label: "control", weight: 0.5, isControl: true },
  { id: "B", label: "variant", weight: 0.5, isControl: false },
];

async function seed(db: Awaited<ReturnType<typeof makeTestDb>>["db"], target = 10) {
  await db.insert(experiments).values({
    key: "opener_copy_v1",
    variable: "abertura",
    status: "running",
    targetSampleSize: target,
    variants: VARIANTS,
  });
}

async function makeLead(db: Awaited<ReturnType<typeof makeTestDb>>["db"], i: number) {
  const [l] = await db
    .insert(leads)
    .values({ funnel: "customer", igUsername: `l${i}`, profileUrl: `https://instagram.com/l${i}` })
    .returning();
  return l!.id;
}

describe("experiment assignment", () => {
  it("is deterministic per (experiment, lead)", () => {
    const a = pickVariant("exp", 42, VARIANTS);
    const b = pickVariant("exp", 42, VARIANTS);
    expect(a.id).toBe(b.id);
  });

  it("splits roughly by weight", () => {
    let a = 0;
    for (let i = 0; i < 400; i++) if (pickVariant("exp", i, VARIANTS).id === "A") a++;
    expect(a).toBeGreaterThan(140);
    expect(a).toBeLessThan(260);
  });

  it("assigns once and reuses the assignment", async () => {
    const { db } = await makeTestDb();
    await seed(db);
    const leadId = await makeLead(db, 1);
    const first = await assignVariant(db, "opener_copy_v1", leadId);
    const second = await assignVariant(db, "opener_copy_v1", leadId);
    expect(first).toBe(second);
  });

  it("does not declare a winner before the sample target is met", async () => {
    const { db } = await makeTestDb();
    await seed(db, 50);
    for (let i = 0; i < 6; i++) {
      const id = await makeLead(db, i);
      await assignVariant(db, "opener_copy_v1", id);
      await recordOutcome(db, "opener_copy_v1", id, i % 2 === 0 ? "replied" : "closed");
    }
    const analysis = await analyzeExperiment(db, "opener_copy_v1");
    expect(analysis?.enoughData).toBe(false);
    expect(analysis?.suggestedWinner).toBeNull();
  });
});
