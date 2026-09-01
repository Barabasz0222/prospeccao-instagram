import "@/lib/dotenv";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import { getSetting, isSystemPaused } from "@/features/settings/repo";
import { loadBusiness } from "@/lib/business";
import { log } from "@/lib/logger";
import { backupDatabase } from "@/db/backup-runner";
import type { JobContext } from "./handlers";
import { runOneJob } from "./runner";
import { enqueue, recoverStaleJobs } from "./queue";
import { enqueueDiscoveryRun } from "./discovery-planner";

const WORKER_ID = `worker-${randomUUID().slice(0, 8)}`;
const POLL_INTERVAL_MS = 2_000;
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

let running = true;
let lastBackup = 0;
let lastDiscovery = 0;
process.on("SIGINT", () => (running = false));
process.on("SIGTERM", () => (running = false));

async function maybeBackup() {
  if (Date.now() - lastBackup <= BACKUP_INTERVAL_MS) return;
  lastBackup = Date.now();
  try {
    backupDatabase();
  } catch (e) {
    log.error("backup.failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Autonomous discovery: enqueue a fresh hunt every N hours (default 8). */
async function maybeDiscover(ctx: JobContext) {
  const everyHours = await getSetting<number>(ctx.db, "discovery.interval_hours", 8);
  if (Date.now() - lastDiscovery <= everyHours * 3_600_000) return;
  lastDiscovery = Date.now();
  try {
    const n = await enqueueDiscoveryRun(ctx.db, loadBusiness());
    if (n > 0) log.info("discovery.scheduled", { runs: n });
  } catch (e) {
    log.error("discovery.schedule_failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

let lastTokenCheck = 0;
/** Enqueue a token-refresh check once a day. */
async function maybeRefreshToken(ctx: JobContext) {
  if (Date.now() - lastTokenCheck <= 24 * 3_600_000) return;
  lastTokenCheck = Date.now();
  await enqueue(ctx.db, {
    kind: "refresh_ig_token",
    payload: {},
    dedupeKey: `token:${new Date().toISOString().slice(0, 10)}`,
    priority: -8,
  });
}

async function main() {
  const ctx: JobContext = { db: getDb(), workerId: WORKER_ID };
  log.info("worker.start", { workerId: WORKER_ID });

  const recovered = await recoverStaleJobs(ctx.db);
  if (recovered > 0) log.warn("worker.recovered_stale_jobs", { recovered });

  while (running) {
    try {
      await maybeBackup();

      if (await isSystemPaused(ctx.db)) {
        await sleep(5_000);
        continue;
      }
      await maybeDiscover(ctx);
      await maybeRefreshToken(ctx);
      const outcome = await runOneJob(ctx);
      if (outcome === "idle") await sleep(POLL_INTERVAL_MS);
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
