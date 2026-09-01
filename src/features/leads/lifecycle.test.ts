import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "@/db/test-helpers";
import { experiments, experimentAssignments, leads } from "@/db/schema";
import { assignVariant } from "@/features/experiments/repo";
import { applyCustomerSignal } from "./lifecycle";

async function seed(db: Awaited<ReturnType<typeof makeTestDb>>["db"], funnel: "customer" | "affiliate" = "customer") {
  const [l] = await db
    .insert(leads)
    .values({
      funnel,
      igUsername: "loja.x",
      profileUrl: "https://instagram.com/loja.x",
      pipelineStage: "whatsapp_handoff",
    })
    .returning();
  return l!.id;
}

describe("applyCustomerSignal", () => {
  it("advances the customer pipeline through every intermediate stage", async () => {
    const { db } = await makeTestDb();
    const id = await seed(db);
    const r = await applyCustomerSignal(db, { type: "active_customer", leadId: id });
    expect(r).toMatchObject({ ok: true, stage: "active_customer" });
    const [lead] = await db.select().from(leads).where(eq(leads.id, id));
    expect(lead!.pipelineStage).toBe("active_customer");
  });

  it("records the experiment outcome for the lead", async () => {
    const { db } = await makeTestDb();
    const id = await seed(db);
    await db.insert(experiments).values({
      key: "opener_copy_v1",
      variable: "abertura",
      status: "running",
      targetSampleSize: 10,
      variants: [{ id: "A", label: "A", weight: 1, isControl: true }],
    });
    await assignVariant(db, "opener_copy_v1", id);
    await applyCustomerSignal(db, { type: "registered", leadId: id });
    const [a] = await db.select().from(experimentAssignments).where(eq(experimentAssignments.leadId, id));
    expect(a!.outcome).toBe("registered");
  });

  it("is idempotent (re-sending the same signal is a no-op)", async () => {
    const { db } = await makeTestDb();
    const id = await seed(db);
    await applyCustomerSignal(db, { type: "registered", leadId: id });
    const r2 = await applyCustomerSignal(db, { type: "registered", leadId: id });
    expect(r2.ok).toBe(true);
  });

  it("rejects an unknown lead", async () => {
    const { db } = await makeTestDb();
    const r = await applyCustomerSignal(db, { type: "registered", igUsername: "nope" });
    expect(r).toEqual({ ok: false, reason: "lead_not_found" });
  });

  it("maps affiliate signals to the affiliate pipeline", async () => {
    const { db } = await makeTestDb();
    const id = await seed(db, "affiliate");
    await db.update(leads).set({ pipelineStage: "interested" }).where(eq(leads.id, id));
    const r = await applyCustomerSignal(db, { type: "affiliate_generated_customer", leadId: id });
    expect(r).toMatchObject({ ok: true, stage: "generated_customer" });
  });
});
