import { getDb } from "@/db/client";
import { log } from "@/lib/logger";
import { HANDLERS } from "./handlers-map";
import { claimNext, completeJob, failJob } from "./queue";
import type { JobContext } from "./handlers";

/**
 * Processes one claimed job. Shared by the long-running worker loop and the
 * test/CLI drain helper so both take the exact same path.
 */
export async function runOneJob(ctx: JobContext): Promise<"idle" | "worked"> {
  const job = await claimNext(ctx.db, ctx.workerId);
  if (!job) return "idle";

  const handler = HANDLERS[job.kind];
  if (!handler) {
    await failJob(ctx.db, job.id, `sem handler para "${job.kind}"`);
    return "worked";
  }
  try {
    const result = await handler(ctx, job.payload as Record<string, unknown>, job.id);
    await completeJob(ctx.db, job.id);
    log.info("job.done", { id: job.id, kind: job.kind, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failJob(ctx.db, job.id, msg);
    log.error("job.failed", { id: job.id, kind: job.kind, error: msg });
  }
  return "worked";
}

/** Drains ready jobs until the queue is idle. For tests and one-shot CLI runs. */
export async function drainQueue(ctx: JobContext, maxJobs = 500): Promise<number> {
  let n = 0;
  for (; n < maxJobs; n++) {
    if ((await runOneJob(ctx)) === "idle") break;
  }
  return n;
}

export function makeContext(workerId = "runner"): JobContext {
  return { db: getDb(), workerId };
}
