import { describe, expect, it } from "vitest";
import { makeTestDb } from "@/db/test-helpers";
import { discoverLead } from "@/features/leads/repo";
import { leads } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  DuplicateSendError,
  handleInboundReply,
  moveChannel,
  recordOutbound,
} from "./repo";

async function seedLead(db: Awaited<ReturnType<typeof makeTestDb>>["db"]) {
  const r = await discoverLead(db, {
    funnel: "customer",
    igUsername: "loja.teste",
    profileUrl: "https://instagram.com/loja.teste",
  });
  return (r as { leadId: number }).leadId;
}

describe("channel lock + handoff", () => {
  it("browser sends the first DM, API is blocked before a reply", async () => {
    const { db } = await makeTestDb();
    const leadId = await seedLead(db);

    await recordOutbound(db, { leadId, channel: "browser", body: "oi" });
    await expect(
      recordOutbound(db, { leadId, channel: "api", body: "segue" }),
    ).rejects.toBeInstanceOf(DuplicateSendError);
  });

  it("transfers ownership to API on inbound reply, then API can send", async () => {
    const { db } = await makeTestDb();
    const leadId = await seedLead(db);
    await recordOutbound(db, { leadId, channel: "browser", body: "oi" });
    await moveChannel(db, leadId, "browser_contact_sent");
    await moveChannel(db, leadId, "waiting_inbound_reply");

    const res = await handleInboundReply(db, {
      metaUserId: "meta-123",
      externalId: "mid-1",
      text: "tenho interesse",
      receivedAt: new Date().toISOString(),
      resolveLeadId: async () => leadId,
    });
    expect(res).toMatchObject({ matched: true, leadId });

    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead!.channelState).toBe("api_active");
    await expect(
      recordOutbound(db, { leadId, channel: "api", body: "que bom!" }),
    ).resolves.toBeTypeOf("number");
  });

  it("is idempotent for a repeated webhook delivery", async () => {
    const { db } = await makeTestDb();
    const leadId = await seedLead(db);
    await moveChannel(db, leadId, "browser_contact_sent");
    await moveChannel(db, leadId, "waiting_inbound_reply");
    const args = {
      metaUserId: "meta-9",
      externalId: "mid-dupe",
      text: "oi",
      receivedAt: new Date().toISOString(),
      resolveLeadId: async () => leadId,
    };
    await handleInboundReply(db, args);
    await handleInboundReply(db, args);
    const rows = await db.query.messages.findMany();
    expect(rows.filter((m) => m.direction === "inbound")).toHaveLength(1);
  });
});
