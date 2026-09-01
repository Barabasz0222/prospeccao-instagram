import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "@/db/test-helpers";
import { leads, messages } from "@/db/schema";
import { FakeBrowserDriver, setBrowserDriver } from "@/integrations/browser";
import { experiments } from "@/db/schema";
import { enqueue } from "./queue";
import { drainQueue } from "./runner";
import { handleDiscoverProfiles, handleProcessInbound, handleSendFirstDm } from "./handlers";

beforeAll(() => {
  Object.assign(process.env, {
    CLAUDEIA_API_KEY: "offline",
    BROWSER_SEND_MODE: "simulation",
    OPERATING_HOURS: "00:00-23:59",
    OPERATING_TIMEZONE: "UTC",
  });
});

describe("end-to-end flow (simulation)", () => {
  it("discovers, sends first DM by browser, hands off to API on reply", async () => {
    const { db } = await makeTestDb();
    const ctx = { db, workerId: "e2e" };
    const driver = new FakeBrowserDriver();
    setBrowserDriver(driver);

    const disc = await handleDiscoverProfiles(ctx, {
      funnel: "customer",
      candidates: [
        { igUsername: "construtora.exemplo", profileUrl: "https://instagram.com/construtora.exemplo" },
        { igUsername: "@Construtora.Exemplo", profileUrl: "https://instagram.com/construtora.exemplo" },
      ],
    });
    expect(disc).toEqual({ created: 1, duplicate: 1, blocked: 0 });

    const [lead] = await db.select().from(leads);
    const payload = { leadId: lead!.id, message: "Oi! Posso te mostrar um caso rápido?", variantId: "v1" };
    const jobId = (await enqueue(db, { kind: "send_first_dm", payload }))!;
    const sent = await handleSendFirstDm(ctx, payload, jobId);
    expect(sent).toMatchObject({ sent: true });
    expect(driver.sent).toHaveLength(1);

    await db.update(leads).set({ igUserId: "meta-1" }).where(eq(leads.id, lead!.id));
    const inbound = await handleProcessInbound(ctx, {
      metaUserId: "meta-1",
      externalId: "mid-1",
      text: "Quanto custa?",
      receivedAt: new Date().toISOString(),
    });
    expect(inbound).toMatchObject({ matched: true, action: "forward_whatsapp" });

    const [after] = await db.select().from(leads).where(eq(leads.id, lead!.id));
    expect(after!.channelState).toBe("api_active");
    expect(after!.pipelineStage).toBe("whatsapp_handoff");

    // idempotent redelivery: no second decision, no second outbound
    await handleProcessInbound(ctx, {
      metaUserId: "meta-1",
      externalId: "mid-1",
      text: "Quanto custa?",
      receivedAt: new Date().toISOString(),
    });
    const msgs = await db.select().from(messages);
    expect(msgs.filter((m) => m.direction === "inbound")).toHaveLength(1);
    expect(msgs.filter((m) => m.channel === "api" && m.direction === "outbound")).toHaveLength(1);
  });

  it("runs discover → score → qualify → first DM autonomously via the queue", async () => {
    const { db } = await makeTestDb();
    const ctx = { db, workerId: "e2e" };
    setBrowserDriver(new FakeBrowserDriver());

    await db.insert(experiments).values({
      key: "opener_copy_v1",
      variable: "abertura",
      status: "running",
      targetSampleSize: 50,
      variants: [
        { id: "opener_A", label: "A", weight: 0.5, isControl: true },
        { id: "opener_B", label: "B", weight: 0.5, isControl: false },
      ],
    });

    await enqueue(db, {
      kind: "discover_from_keywords",
      payload: {
        funnel: "customer",
        queries: [{ kind: "keyword", term: "sistema para construtora", limit: 5 }],
      },
    });

    await drainQueue(ctx);

    const all = await db.select().from(leads);
    expect(all.length).toBe(5);
    // enrich_profile ran and filled signals before scoring
    expect(all.every((l) => l.icpScore !== null && l.bio !== null)).toBe(true);

    const qualified = all.filter((l) => l.pipelineStage === "contacted" || l.channelState === "waiting_inbound_reply");
    expect(qualified.length).toBeGreaterThan(0);
    // every qualified lead got an assigned opener variant recorded
    const variants = await db.query.experimentAssignments.findMany();
    expect(variants.length).toBe(qualified.length);
  });
});
