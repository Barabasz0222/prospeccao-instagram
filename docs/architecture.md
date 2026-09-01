# Architecture (dev)

## Overview

A modular monolith. One Next.js app serves the operator panel and the Meta
webhook route handler; one long-running Node worker drains a durable job queue
stored in SQLite. No microservices, no external queue, no speculative
abstraction.

```
                  ┌─────────────── Next.js (src/app) ───────────────┐
   operator  ───▶ │  panel (RSC, PT-BR)   /api/webhooks/instagram   │
                  └───────┬───────────────────────┬─────────────────┘
                          │ server actions        │ enqueue(process_inbound)
                          ▼                        ▼
                  ┌──────────────── SQLite (src/db) ────────────────┐
                  │ leads · conversations · messages · jobs · ...   │
                  └───────┬────────────────────────────────────────-┘
                          │ claimNext / complete / fail
                          ▼
                  ┌──────────────── worker (src/worker) ────────────┐
                  │ discover_profiles · send_first_dm · process_… │
                  └───┬───────────────┬───────────────┬────────────┘
                      ▼               ▼               ▼
             browser (CDP)     openai (Claude)   instagram API
```

## Channels

**Step 1 — Browser (first contact).** The official API cannot open a
conversation with someone who never replied, so the first DM goes out through
the operator's real Chrome, connected over CDP (`chromium.connectOverCDP`).
The driver reuses `browser.contexts()[0]`, opens **its own tab**, never calls
`bringToFront()`, restricts navigation to `instagram.com`, and closes the tab
in a `finally` block. A mutex (`src/lib/mutex.ts`) guarantees one browser job
at a time. If CDP is unreachable the driver returns `browser_unavailable` — it
never spawns a new Chrome — and the caller trips the breaker.

`BROWSER_SEND_MODE`: `simulation` (FakeBrowserDriver, no Chrome) →
`dry_run` (composes but never clicks send) → `live`.

**Step 2 — Official API (continuation).** The Meta webhook receives replies.
`handleInboundReply` matches the Meta user id to a lead, writes the inbound
message, transfers `conversations.ownerChannel` from `browser` to `api`, opens
the 24h messaging window, and promotes the channel state to `api_active`.
After the handoff the browser never touches that thread. Every API send checks
opt-out, channel ownership, and the messaging window; a closed window goes to
the exceptions queue rather than falling back to the browser.

**Step 3 — WhatsApp.** Interested store → `WHATSAPP_LINK`. Interested creator →
`AFFILIATE_GROUP_LINK` (falls back to WhatsApp when unset).

## State

`leads.pipelineStage` and `leads.channelState` are **independent** columns.
Transition tables and guards live in `src/lib/states.ts`; every transition goes
through `moveChannel` which refuses invalid edges. `do_not_contact` and
`completed` are absorbing.

## Jobs

`src/worker/queue.ts`: `enqueue` (optional `dedupeKey` = idempotency),
`claimNext` (atomic claim via conditional UPDATE), `completeJob`, `failJob`
(exponential backoff, dead-letter at `maxAttempts`), `recoverStaleJobs`
(requeues jobs a crashed worker left `running`).

## Conversation engine

`src/features/conversations/engine.ts`. `classifyIntent` uses the fast model;
`decideReply` uses the writing model. Deterministic opt-out detection runs
first. Every generated message passes the verified-claims guard before it can
be sent; a violation escalates to a human. Offline mode (`CLAUDEIA_API_KEY`
unset or `offline`) swaps in heuristics so simulation and CI need no key.
Every real call is written to `ai_calls` (model, tokens, estimated cost) and
`assertBudgetAvailable` pauses the system at `CLAUDEIA_MONTHLY_BUDGET_USD`.

## Safety trips (`src/worker/safety.ts`)

`checkCircuitBreaker` inspects the recent `browser_send_log` failure rate;
`tripAndPause` records a critical `integration_alerts` row and flips
`system.paused`. The worker loop and `send_first_dm` both check `isSystemPaused`
before doing anything.

## Testing

- `pnpm test` — 30+ unit/integration tests over an in-memory libsql DB with
  real migrations (`src/db/test-helpers.ts`): lead dedupe, pipeline/channel
  transitions, queue idempotency + dead-letter + crash recovery, channel lock,
  browser→webhook→API handoff, webhook idempotency, warmup ramp, operating
  hours, budget/breaker, claims guard, and a full simulated flow
  (`src/worker/flow.e2e.test.ts`).
- Browser layer in three levels: (1) fake driver + simulated pages; (2) real
  `dry_run` with the final send blocked; (3) limited real smoke test, only
  after explicit operator authorization. Levels 2–3 are the operator's to run
  on their machine (see `SETUP.md`).

## Discovery, scoring, experiments, lifecycle

- **Discovery**: `discover_from_keywords` → `BrowserDriver.discoverProfiles`
  (CDP best-effort DOM scrape; fake driver returns deterministic fixtures) →
  `discover_profiles` (idempotent `discoverLead`) → one `score_lead` job per
  new lead.
- **Scoring** (`src/features/leads/scoring.ts`): deterministic. Customer funnel
  weighs ICP keyword/segment overlap, geography, and actor type
  (decision_maker/owner/store/…). Affiliate funnel weighs `affiliateTopics`
  relevance, an audience band (2k–150k), creator detection, and geography.
  `score_lead` qualifies above `leads.qualify_threshold` (a tunable setting),
  assigns an opener A/B variant, generates the opener, and queues the first DM.
- **Experiments** (`src/features/experiments`): `pickVariant` is a hash of
  `(experimentKey, leadId)` — deterministic, weighted, stable across re-runs.
  `recordOutcome` is called on each pipeline advance; `analyzeExperiment` never
  returns a `suggestedWinner` before `targetSampleSize` assignments.
- **Lifecycle** (`src/features/leads/lifecycle.ts`): `registered`,
  `active_customer`, `joined_affiliate_group`, `generated_customer` are set
  only by an external signal — `POST /api/ingest/lifecycle` (Bearer token) or
  the panel buttons — never inferred from a conversation. `advancePipeline`
  walks every intermediate stage so each hop stays valid and audited.
- **Follow-up**: `send_followup` sends one browser nudge if a thread stays
  silent past `followup.delay_days`; it shares `runBrowserSend` with the first
  DM (mutex, rate gate, circuit breaker, evidence capture).
- **Backup**: `backupDatabase` runs every 6h in the worker with retention;
  `restoreDatabase` / `pnpm db:restore` for recovery (both covered by a test).

## Known MVP trade-offs

- Node 22 LTS (spec asked 24; 22 is the current LTS on this machine).
- `better-sqlite3` needs a C toolchain on Windows; we use `@libsql/client`
  (prebuilt) with the Drizzle `libsql` driver. Same SQLite semantics (WAL,
  FKs, busy timeout).
- `CdpBrowserDriver.discoverProfiles` / `sendDm` selectors are a starting
  point; Instagram's DOM shifts, so they are tuned during the `dry_run` phase
  against the live site (evidence lands in `screenshots/`). None of this blocks
  tests — `simulation` mode uses the fake driver.
- WhatsApp Business templates (`src/integrations/whatsapp/templates.ts`) are
  defined and window/opt-in-gated but not wired to a live WA number yet; the
  funnel currently just hands off the link.
