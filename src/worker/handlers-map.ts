import {
  handleDiscoverFromKeywords,
  handleDiscoverOne,
  handleDiscoverProfiles,
  handleEnrichProfile,
  handleProcessInbound,
  handleRefreshIgToken,
  handleScoreLead,
  handleSendFollowup,
  type JobContext,
} from "./handlers";
import { backupDatabase } from "@/db/backup-runner";

export type JobHandler = (
  ctx: JobContext,
  payload: Record<string, unknown>,
  jobId: number,
) => Promise<unknown>;

export const HANDLERS: Record<string, JobHandler> = {
  discover_from_keywords: (c, p) => handleDiscoverFromKeywords(c, p as never),
  discover_one: (c, p) => handleDiscoverOne(c, p as never),
  discover_profiles: (c, p) => handleDiscoverProfiles(c, p as never),
  enrich_profile: (c, p) => handleEnrichProfile(c, p as never),
  score_lead: (c, p) => handleScoreLead(c, p as never),
  send_followup: (c, p) => handleSendFollowup(c, p as never),
  process_inbound: (c, p) => handleProcessInbound(c, p as never),
  refresh_ig_token: (c) => handleRefreshIgToken(c),
  backup_db: async () => ({ dest: backupDatabase() }),
};
