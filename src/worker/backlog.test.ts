import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "@/db/test-helpers";
import { leads } from "@/db/schema";
import { loadBusiness } from "@/lib/business";
import { setSetting } from "@/features/settings/repo";
import { enqueueDiscoveryRun, expireStaleLeads, pendingBacklog } from "./discovery-planner";

beforeAll(() => {
  Object.assign(process.env, { CLAUDEIA_API_KEY: "offline", BROWSER_SEND_MODE: "simulation" });
});

async function addLead(
  db: Awaited<ReturnType<typeof makeTestDb>>["db"],
  i: number,
  createdAt = new Date().toISOString(),
) {
  await db.insert(leads).values({
    funnel: "customer",
    igUsername: `l${i}`,
    profileUrl: `https://instagram.com/l${i}`,
    pipelineStage: "qualified",
    channelState: "browser_contact_pending",
    createdAt,
  });
}

describe("discovery backlog control", () => {
  it("counts qualified leads still waiting for a first DM", async () => {
    const { db } = await makeTestDb();
    for (let i = 0; i < 3; i++) await addLead(db, i);
    expect(await pendingBacklog(db)).toBe(3);
  });

  it("skips discovery when the backlog cap is reached", async () => {
    const { db } = await makeTestDb();
    await setSetting(db, "discovery.max_backlog", 2);
    for (let i = 0; i < 3; i++) await addLead(db, i);
    const runs = await enqueueDiscoveryRun(db, loadBusiness());
    expect(runs).toBe(0);
  });

  it("expires leads never contacted past the stale window", async () => {
    const { db } = await makeTestDb();
    await setSetting(db, "leads.stale_days", 30);
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await addLead(db, 1, old);
    await addLead(db, 2); // fresh
    const expired = await expireStaleLeads(db);
    expect(expired).toBe(1);
    const [l1] = await db.select().from(leads).where(eq(leads.igUsername, "l1"));
    expect(l1!.pipelineStage).toBe("closed");
  });
});
