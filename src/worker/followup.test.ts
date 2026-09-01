import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "@/db/test-helpers";
import { conversations, leads, messages } from "@/db/schema";
import { FakeBrowserDriver, setBrowserDriver } from "@/integrations/browser";
import { enqueue } from "./queue";
import { drainQueue } from "./runner";
import { handleProcessInbound, handleSendFollowup } from "./handlers";

beforeAll(() => {
  Object.assign(process.env, {
    CLAUDEIA_API_KEY: "offline",
    BROWSER_SEND_MODE: "simulation",
    OPERATING_HOURS: "00:00-23:59",
    OPERATING_TIMEZONE: "UTC",
  });
});

async function contactedLead(db: Awaited<ReturnType<typeof makeTestDb>>["db"]) {
  setBrowserDriver(new FakeBrowserDriver());
  const [lead] = await db
    .insert(leads)
    .values({
      funnel: "customer",
      igUsername: "loja.f",
      profileUrl: "https://instagram.com/loja.f",
      pipelineStage: "contacted",
      channelState: "browser_contact_pending",
    })
    .returning();
  // simulate the first DM having been sent
  const [conv] = await db.insert(conversations).values({ leadId: lead!.id, ownerChannel: "browser" }).returning();
  await db.insert(messages).values({
    conversationId: conv!.id,
    direction: "outbound",
    channel: "browser",
    body: "primeira",
  });
  await db.update(leads).set({ channelState: "waiting_inbound_reply" }).where(eq(leads.id, lead!.id));
  return lead!.id;
}

describe("follow-up", () => {
  it("sends one nudge while the thread is silent", async () => {
    const { db } = await makeTestDb();
    const ctx = { db, workerId: "t" };
    const id = await contactedLead(db);
    const jobId = (await enqueue(db, { kind: "send_followup", payload: { leadId: id, kind: "browser" } }))!;
    const r = await handleSendFollowup(ctx, { leadId: id, kind: "browser" }, jobId);
    expect(r).toMatchObject({ sent: true });
  });

  it("does not follow up after a reply arrived", async () => {
    const { db } = await makeTestDb();
    const ctx = { db, workerId: "t" };
    const id = await contactedLead(db);
    await db.update(leads).set({ igUserId: "meta-f" }).where(eq(leads.id, id));
    await handleProcessInbound(ctx, {
      metaUserId: "meta-f",
      externalId: "mid-f",
      text: "oi, tenho interesse",
      receivedAt: new Date().toISOString(),
    });
    const jobId = (await enqueue(db, { kind: "send_followup", payload: { leadId: id, kind: "browser" } }))!;
    const r = await handleSendFollowup(ctx, { leadId: id, kind: "browser" }, jobId);
    expect(r).toMatchObject({ skipped: expect.any(String) });
  });

  it("respects the follow-up limit", async () => {
    const { db } = await makeTestDb();
    const ctx = { db, workerId: "t" };
    const id = await contactedLead(db);
    // add a second outbound (the follow-up already sent)
    const [conv] = await db.select().from(conversations).where(eq(conversations.leadId, id));
    await db.insert(messages).values({ conversationId: conv!.id, direction: "outbound", channel: "browser", body: "fup1" });
    const jobId = (await enqueue(db, { kind: "send_followup", payload: { leadId: id, kind: "browser" } }))!;
    const r = await handleSendFollowup(ctx, { leadId: id, kind: "browser" }, jobId);
    expect(r).toEqual({ skipped: "followup_limit" });
    void drainQueue;
  });
});
