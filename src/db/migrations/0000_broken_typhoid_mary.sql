CREATE TABLE `ai_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_ai_calls_lead` ON `ai_calls` (`lead_id`);--> statement-breakpoint
CREATE TABLE `browser_send_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`job_id` integer,
	`mode` text NOT NULL,
	`variant_id` text,
	`body` text NOT NULL,
	`result` text NOT NULL,
	`screenshot_path` text,
	`accessibility_snapshot_path` text,
	`url` text,
	`console_errors` text,
	`network_failures` text,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`owner_channel` text DEFAULT 'browser' NOT NULL,
	`meta_conversation_id` text,
	`api_window_expires_at` text,
	`last_inbound_at` text,
	`last_outbound_at` text,
	`stage` text DEFAULT 'opening' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_conversations_lead` ON `conversations` (`lead_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_conversations_meta_id` ON `conversations` (`meta_conversation_id`);--> statement-breakpoint
CREATE TABLE `decisions_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer,
	`actor` text DEFAULT 'ai' NOT NULL,
	`decision` text NOT NULL,
	`rationale` text,
	`inputs` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `do_not_contact` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ig_username` text,
	`meta_user_id` text,
	`reason` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_dnc_username` ON `do_not_contact` (`ig_username`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_dnc_meta_user` ON `do_not_contact` (`meta_user_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer,
	`type` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`occurred_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_events_type` ON `events` (`type`);--> statement-breakpoint
CREATE TABLE `exceptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer,
	`kind` text NOT NULL,
	`detail` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `experiment_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`experiment_id` integer NOT NULL,
	`lead_id` integer NOT NULL,
	`variant_id` text NOT NULL,
	`outcome` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_assignment_experiment_lead` ON `experiment_assignments` (`experiment_id`,`lead_id`);--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`variable` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`variants` text NOT NULL,
	`target_sample_size` integer NOT NULL,
	`winner_variant_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiments_key_unique` ON `experiments` (`key`);--> statement-breakpoint
CREATE TABLE `integration_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`resolved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`run_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`locked_at` text,
	`locked_by` text,
	`last_error` text,
	`dedupe_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_jobs_dedupe_key` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `ix_jobs_poll` ON `jobs` (`status`,`run_at`,`priority`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`funnel` text NOT NULL,
	`ig_username` text NOT NULL,
	`ig_user_id` text,
	`profile_url` text NOT NULL,
	`display_name` text,
	`bio` text,
	`category` text,
	`location` text,
	`follower_count` integer,
	`actor_type` text DEFAULT 'unknown' NOT NULL,
	`icp_score` real,
	`niche` text,
	`source_keyword` text,
	`discovery_source` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`pipeline_stage` text DEFAULT 'discovered' NOT NULL,
	`channel_state` text DEFAULT 'browser_contact_pending' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`best_send_window` text,
	`next_action_at` text,
	`next_action_kind` text,
	`public_signals` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_leads_username_funnel` ON `leads` (`ig_username`,`funnel`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_leads_ig_user_id` ON `leads` (`ig_user_id`);--> statement-breakpoint
CREATE INDEX `ix_leads_pipeline_stage` ON `leads` (`pipeline_stage`);--> statement-breakpoint
CREATE INDEX `ix_leads_channel_state` ON `leads` (`channel_state`);--> statement-breakpoint
CREATE INDEX `ix_leads_next_action_at` ON `leads` (`next_action_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`direction` text NOT NULL,
	`channel` text NOT NULL,
	`body` text NOT NULL,
	`variant_id` text,
	`external_id` text,
	`intent` text,
	`sent_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`meta` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_messages_external_id` ON `messages` (`external_id`);--> statement-breakpoint
CREATE INDEX `ix_messages_conversation` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `meta_identity_map` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meta_user_id` text NOT NULL,
	`lead_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_meta_identity_meta_user` ON `meta_identity_map` (`meta_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_meta_identity_lead` ON `meta_identity_map` (`lead_id`);--> statement-breakpoint
CREATE TABLE `send_counters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`channel` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_send_counters_day_channel` ON `send_counters` (`day`,`channel`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` text DEFAULT 'system' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text DEFAULT 'instagram' NOT NULL,
	`external_id` text NOT NULL,
	`payload` text NOT NULL,
	`signature_valid` integer NOT NULL,
	`processed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_webhook_events_external` ON `webhook_events` (`provider`,`external_id`);