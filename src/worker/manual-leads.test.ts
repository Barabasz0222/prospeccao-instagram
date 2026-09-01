import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "@/db/test-helpers";
import { experiments, leads } from "@/db/schema";
import { FakeBrowserDriver, setBrowserDriver } from "@/integrations/browser";
import { discoverLead } from "@/features/leads/repo";
import { enqueue } from "./queue";
import { drainQueue } from "./runner";

beforeAll(() => {
  Object.assign(process.env, {
    CLAUDEIA_API_KEY: "offline",
    BROWSER_SEND_MODE: "simulation",
    OPERATING_HOURS: "00:00-23:59",
    OPERATING_TIMEZONE: "UTC",
  });
});

describe("operator-supplied leads", () => {
  it("bypass the score threshold and get a first DM queued", async () => {
    const { db } = await makeTestDb();
    setBrowserDriver(new FakeBrowserDriver());
    await db.insert(experiments).values({
      key: "opener_copy_v1",
      variable: "abertura",
      status: "running",
      targetSampleSize: 10,
      variants: [{ id: "opener_A", label: "A", weight: 1, isControl: true }],
    });

    // No bio/category -> low score, but discoverySource "manual"
    const r = await discoverLead(db, {
      funnel: "customer",
      igUsername: "cliente.real",
      profileUrl: "https://instagram.com/cliente.real",
      discoverySource: "manual",
      actorType: "unknown",
    });
    expect(r.status).toBe("created");
    await enqueue(db, { kind: "score_lead", payload: { leadId: (r as { leadId: number }).leadId } });

    await drainQueue({ db, workerId: "t" });

    const [lead] = await db.select().from(leads).where(eq(leads.id, (r as { leadId: number }).leadId));
    expect(lead!.icpScore).toBeLessThan(0.4); // would normally be rejected
    expect(["contacted", "qualified"]).toContain(lead!.pipelineStage);
    expect(lead!.channelState).toBe("waiting_inbound_reply");
  });
});
