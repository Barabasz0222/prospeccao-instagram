import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { jobs } from "@/db/schema";
import * as schema from "@/db/schema";

type Db = LibSQLDatabase<typeof schema>;

const nowIso = () => new Date().toISOString();

export type EnqueueArgs = {
  kind: string;
  payload: Record<string, unknown>;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  dedupeKey?: string;
};

/** Enqueue a job. A set dedupeKey makes the job idempotent (at most one). */
export async function enqueue(db: Db, args: EnqueueArgs): Promise<number | null> {
  try {
    const [row] = await db
      .insert(jobs)
      .values({
        kind: args.kind,
        payload: args.payload,
        runAt: (args.runAt ?? new Date()).toISOString(),
        priority: args.priority ?? 0,
        maxAttempts: args.maxAttempts ?? 5,
        dedupeKey: args.dedupeKey,
      })
      .returning({ id: jobs.id });
    return row!.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // An unfinished job with this dedupeKey already exists — that's the point.
    if (/unique|constraint/i.test(msg)) return null;
    throw e;
  }
}

/** Atomically claim the next runnable job for this worker. */
export async function claimNext(db: Db, workerId: string) {
  const candidates = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, nowIso())))
    .orderBy(sql`${jobs.priority} DESC`, asc(jobs.runAt))
    .limit(1);
  const job = candidates[0];
  if (!job) return null;

  const res = await db
    .update(jobs)
    .set({ status: "running", lockedAt: nowIso(), lockedBy: workerId, updatedAt: nowIso() })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "pending")))
    .returning({ id: jobs.id });

  return res.length > 0 ? { ...job, status: "running" as const } : null;
}

export async function completeJob(db: Db, id: number): Promise<void> {
  await db
    .update(jobs)
    .set({ status: "done", updatedAt: nowIso() })
    .where(eq(jobs.id, id));
}

/** Retry with backoff; route to dead-letter once maxAttempts is exhausted. */
export async function failJob(db: Db, id: number, error: string): Promise<void> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) return;
  const attempts = job.attempts + 1;
  const dead = attempts >= job.maxAttempts;
  const backoffMs = Math.min(60_000 * 2 ** (attempts - 1), 3_600_000);
  await db
    .update(jobs)
    .set({
      status: dead ? "dead" : "pending",
      attempts,
      lastError: error.slice(0, 2000),
      lockedAt: null,
      lockedBy: null,
      runAt: new Date(Date.now() + backoffMs).toISOString(),
      updatedAt: nowIso(),
    })
    .where(eq(jobs.id, id));
}

/** Requeue jobs left "running" by a crashed worker. */
export async function recoverStaleJobs(db: Db, olderThanMs = 5 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const res = await db
    .update(jobs)
    .set({ status: "pending", lockedAt: null, lockedBy: null, updatedAt: nowIso() })
    .where(and(eq(jobs.status, "running"), or(isNull(jobs.lockedAt), lte(jobs.lockedAt, cutoff))))
    .returning({ id: jobs.id });
  return res.length;
}
