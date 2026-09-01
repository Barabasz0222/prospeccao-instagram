import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import { isSystemPaused } from "@/features/settings/repo";
import { log } from "@/lib/logger";
import {
  handleDiscoverProfiles,
  handleProcessInbound,
  handleSendFirstDm,
  type JobContext,
} from "./handlers";
import { claimNext, completeJob, failJob, recoverStaleJobs } from "./queue";

const WORKER_ID = `worker-${randomUUID().slice(0, 8)}`;
const POLL_INTERVAL_MS = 2_000;

const HANDLERS: Record<
  string,
  (ctx: JobContext, payload: Record<string, unknown>, jobId: number) => Promise<unknown>
> = {
  discover_profiles: (c, p) => handleDiscoverProfiles(c, p as never),
  send_first_dm: (c, p, id) => handleSendFirstDm(c, p as never, id),
  process_inbound: (c, p) => handleProcessInbound(c, p as never),
  // score_lead / followup handlers can be added here.
  score_lead: async () => ({ noop: true }),
};

let running = true;
process.on("SIGINT", () => (running = false));
process.on("SIGTERM", () => (running = false));

async function tick(ctx: JobContext): Promise<boolean> {
  const job = await claimNext(ctx.db, ctx.workerId);
  if (!job) return false;

  const handler = HANDLERS[job.kind];
  if (!handler) {
    await failJob(ctx.db, job.id, `sem handler para "${job.kind}"`);
    return true;
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
  return true;
}

async function main() {
  const ctx: JobContext = { db: getDb(), workerId: WORKER_ID };
  log.info("worker.start", { workerId: WORKER_ID });

  const recovered = await recoverStaleJobs(ctx.db);
  if (recovered > 0) log.warn("worker.recovered_stale_jobs", { recovered });

  while (running) {
    try {
      if (await isSystemPaused(ctx.db)) {
        await sleep(5_000);
        continue;
      }
      const didWork = await tick(ctx);
      if (!didWork) await sleep(POLL_INTERVAL_MS);
    } catch (e) {
      log.error("worker.loop_error", { error: e instanceof Error ? e.message : String(e) });
      await sleep(POLL_INTERVAL_MS);
    }
  }
  log.info("worker.stop", { workerId: WORKER_ID });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

void main();
