import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const timestamps = {
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
};

/** Prospecting leads. Kept fully separate from the operator's personal DMs. */
export const leads = sqliteTable(
  "leads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    funnel: text("funnel", { enum: ["customer", "affiliate"] }).notNull(),
    // Instagram public identity
    igUsername: text("ig_username").notNull(),
    igUserId: text("ig_user_id"),
    profileUrl: text("profile_url").notNull(),
    displayName: text("display_name"),
    bio: text("bio"),
    category: text("category"),
    location: text("location"),
    followerCount: integer("follower_count"),
    // Classification
    actorType: text("actor_type", {
      enum: ["store", "employee", "owner", "decision_maker", "creator", "unknown"],
    })
      .notNull()
      .default("unknown"),
    icpScore: real("icp_score"),
    niche: text("niche"),
    sourceKeyword: text("source_keyword"),
    discoverySource: text("discovery_source"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    // State (pipeline and channel are independent)
    pipelineStage: text("pipeline_stage").notNull().default("discovered"),
    channelState: text("channel_state").notNull().default("browser_contact_pending"),
    priority: integer("priority").notNull().default(0),
    bestSendWindow: text("best_send_window"),
    nextActionAt: text("next_action_at"),
    nextActionKind: text("next_action_kind"),
    publicSignals: text("public_signals", { mode: "json" }).$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => ({
    uxUsernameFunnel: uniqueIndex("ux_leads_username_funnel").on(t.igUsername, t.funnel),
    uxIgUserId: uniqueIndex("ux_leads_ig_user_id").on(t.igUserId),
    ixStage: index("ix_leads_pipeline_stage").on(t.pipelineStage),
    ixChannel: index("ix_leads_channel_state").on(t.channelState),
    ixNextAction: index("ix_leads_next_action_at").on(t.nextActionAt),
  }),
);

/** One conversation thread per lead per channel origin. */
export const conversations = sqliteTable(
  "conversations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    // Channel ownership lock: only one channel may send at a time.
    ownerChannel: text("owner_channel", { enum: ["browser", "api", "none"] })
      .notNull()
      .default("browser"),
    metaConversationId: text("meta_conversation_id"),
    apiWindowExpiresAt: text("api_window_expires_at"),
    lastInboundAt: text("last_inbound_at"),
    lastOutboundAt: text("last_outbound_at"),
    stage: text("stage").notNull().default("opening"),
    ...timestamps,
  },
  (t) => ({
    uxLead: uniqueIndex("ux_conversations_lead").on(t.leadId),
    uxMetaConv: uniqueIndex("ux_conversations_meta_id").on(t.metaConversationId),
  }),
);

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id),
    direction: text("direction", { enum: ["outbound", "inbound"] }).notNull(),
    channel: text("channel", { enum: ["browser", "api"] }).notNull(),
    body: text("body").notNull(),
    variantId: text("variant_id"),
    // Provider dedupe key (Meta message id, or browser job id for outbound).
    externalId: text("external_id"),
    intent: text("intent"),
    sentAt: text("sent_at").notNull().default(now),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => ({
    uxExternal: uniqueIndex("ux_messages_external_id").on(t.externalId),
    ixConv: index("ix_messages_conversation").on(t.conversationId),
  }),
);

/** Maps a Meta-side user/conversation id to our lead once the lead replies. */
export const metaIdentityMap = sqliteTable(
  "meta_identity_map",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    metaUserId: text("meta_user_id").notNull(),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    ...timestamps,
  },
  (t) => ({
    uxMetaUser: uniqueIndex("ux_meta_identity_meta_user").on(t.metaUserId),
    uxLead: uniqueIndex("ux_meta_identity_lead").on(t.leadId),
  }),
);

/** Durable job queue (SQLite replaces Redis for the MVP). */
export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status", {
      enum: ["pending", "running", "done", "failed", "dead"],
    })
      .notNull()
      .default("pending"),
    priority: integer("priority").notNull().default(0),
    runAt: text("run_at").notNull().default(now),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: text("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    // Idempotency: a job with a set dedupe key can exist at most once unfinished.
    dedupeKey: text("dedupe_key"),
    ...timestamps,
  },
  (t) => ({
    uxDedupe: uniqueIndex("ux_jobs_dedupe_key").on(t.dedupeKey),
    ixPoll: index("ix_jobs_poll").on(t.status, t.runAt, t.priority),
  }),
);

/** Raw webhook deliveries, stored for signature audit + idempotency. */
export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull().default("instagram"),
    externalId: text("external_id").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    signatureValid: integer("signature_valid", { mode: "boolean" }).notNull(),
    processedAt: text("processed_at"),
    ...timestamps,
  },
  (t) => ({
    uxExternal: uniqueIndex("ux_webhook_events_external").on(t.provider, t.externalId),
  }),
);

/** Every browser send attempt, with evidence pointers on failure. */
export const browserSendLog = sqliteTable("browser_send_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id),
  jobId: integer("job_id").references(() => jobs.id),
  mode: text("mode", { enum: ["simulation", "dry_run", "live"] }).notNull(),
  variantId: text("variant_id"),
  body: text("body").notNull(),
  result: text("result", { enum: ["sent", "blocked", "failed"] }).notNull(),
  screenshotPath: text("screenshot_path"),
  accessibilitySnapshotPath: text("accessibility_snapshot_path"),
  url: text("url"),
  consoleErrors: text("console_errors", { mode: "json" }).$type<string[]>(),
  networkFailures: text("network_failures", { mode: "json" }).$type<string[]>(),
  error: text("error"),
  ...timestamps,
});

/** LLM call ledger — model, tokens, estimated cost, for per-lead economics. */
export const aiCalls = sqliteTable(
  "ai_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leadId: integer("lead_id").references(() => leads.id),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
    ...timestamps,
  },
  (t) => ({ ixLead: index("ix_ai_calls_lead").on(t.leadId) }),
);

/** A/B experiments: one variable at a time, control group, recorded sample. */
export const experiments = sqliteTable("experiments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  variable: text("variable").notNull(),
  status: text("status", { enum: ["draft", "running", "paused", "concluded"] })
    .notNull()
    .default("draft"),
  variants: text("variants", { mode: "json" }).$type<
    { id: string; label: string; weight: number; isControl: boolean }[]
  >().notNull(),
  targetSampleSize: integer("target_sample_size").notNull(),
  winnerVariantId: text("winner_variant_id"),
  ...timestamps,
});

export const experimentAssignments = sqliteTable(
  "experiment_assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    experimentId: integer("experiment_id")
      .notNull()
      .references(() => experiments.id),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id),
    variantId: text("variant_id").notNull(),
    outcome: text("outcome"),
    ...timestamps,
  },
  (t) => ({
    uxOne: uniqueIndex("ux_assignment_experiment_lead").on(t.experimentId, t.leadId),
  }),
);

/** Structured analytics events — one per action. */
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leadId: integer("lead_id").references(() => leads.id),
    type: text("type").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    occurredAt: text("occurred_at").notNull().default(now),
    ...timestamps,
  },
  (t) => ({ ixType: index("ix_events_type").on(t.type) }),
);

/** Human-readable log of autonomous AI decisions. */
export const decisionsLog = sqliteTable("decisions_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").references(() => leads.id),
  actor: text("actor").notNull().default("ai"),
  decision: text("decision").notNull(),
  rationale: text("rationale"),
  inputs: text("inputs", { mode: "json" }).$type<Record<string, unknown>>(),
  ...timestamps,
});

/** Anything the system could not handle autonomously. */
export const exceptions = sqliteTable("exceptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").references(() => leads.id),
  kind: text("kind").notNull(),
  detail: text("detail"),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  ...timestamps,
});

export const integrationAlerts = sqliteTable("integration_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull(),
  message: text("message").notNull(),
  resolvedAt: text("resolved_at"),
  ...timestamps,
});

/** Permanent no-contact list. Absorbing across all campaigns and channels. */
export const doNotContact = sqliteTable(
  "do_not_contact",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    igUsername: text("ig_username"),
    metaUserId: text("meta_user_id"),
    reason: text("reason").notNull(),
    ...timestamps,
  },
  (t) => ({
    uxUsername: uniqueIndex("ux_dnc_username").on(t.igUsername),
    uxMeta: uniqueIndex("ux_dnc_meta_user").on(t.metaUserId),
  }),
);

/** Key-value operational settings the panel and AI may tune within bounds. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedBy: text("updated_by").notNull().default("system"),
  ...timestamps,
});

/** Daily send counters for rate limiting and warmup. */
export const sendCounters = sqliteTable(
  "send_counters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    day: text("day").notNull(), // YYYY-MM-DD in operating timezone
    channel: text("channel", { enum: ["browser", "api"] }).notNull(),
    count: integer("count").notNull().default(0),
    ...timestamps,
  },
  (t) => ({ uxDayChannel: uniqueIndex("ux_send_counters_day_channel").on(t.day, t.channel) }),
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
