import { describe, expect, it } from "vitest";
import { makeTestDb } from "@/db/test-helpers";
import { claimNext, enqueue, failJob, recoverStaleJobs } from "./queue";

describe("job queue", () => {
  it("enqueues and claims exactly once", async () => {
    const { db } = await makeTestDb();
    await enqueue(db, { kind: "test", payload: { n: 1 } });
    const a = await claimNext(db, "w1");
    const b = await claimNext(db, "w2");
    expect(a?.kind).toBe("test");
    expect(b).toBeNull();
  });

  it("honours the dedupe key", async () => {
    const { db } = await makeTestDb();
    const first = await enqueue(db, { kind: "dm", payload: {}, dedupeKey: "lead:7" });
    const second = await enqueue(db, { kind: "dm", payload: {}, dedupeKey: "lead:7" });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("dead-letters after max attempts", async () => {
    const { db } = await makeTestDb();
    const id = (await enqueue(db, { kind: "x", payload: {}, maxAttempts: 2 }))!;
    await failJob(db, id, "boom");
    await failJob(db, id, "boom again");
    const rows = await db.query.jobs.findMany();
    expect(rows[0]!.status).toBe("dead");
  });

  it("recovers stale running jobs after a crash", async () => {
    const { db } = await makeTestDb();
    const id = (await enqueue(db, { kind: "x", payload: {} }))!;
    await claimNext(db, "w1");
    const recovered = await recoverStaleJobs(db, -1);
    expect(recovered).toBe(1);
    const again = await claimNext(db, "w2");
    expect(again?.id).toBe(id);
  });
});
