import { describe, expect, it } from "vitest";
import { makeTestDb } from "@/db/test-helpers";
import { addToDoNotContact, discoverLead } from "./repo";

const base = {
  funnel: "customer" as const,
  igUsername: "obras.maringa",
  profileUrl: "https://instagram.com/obras.maringa",
};

describe("discoverLead", () => {
  it("creates then dedupes on (username, funnel)", async () => {
    const { db } = await makeTestDb();
    const a = await discoverLead(db, base);
    expect(a.status).toBe("created");
    const b = await discoverLead(db, { ...base, igUsername: "@Obras.Maringa" });
    expect(b).toEqual({ status: "duplicate", leadId: (a as { leadId: number }).leadId });
  });

  it("allows the same handle in the other funnel", async () => {
    const { db } = await makeTestDb();
    await discoverLead(db, base);
    const other = await discoverLead(db, { ...base, funnel: "affiliate" });
    expect(other.status).toBe("created");
  });

  it("refuses a do-not-contact handle", async () => {
    const { db } = await makeTestDb();
    await addToDoNotContact(db, { igUsername: "obras.maringa", reason: "opt_out" });
    const r = await discoverLead(db, base);
    expect(r).toEqual({ status: "blocked", reason: "opt_out" });
  });
});
