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

## Known MVP trade-offs

- Node 22 LTS (spec asked 24; 22 is the current LTS on this machine).
- `better-sqlite3` needs a C toolchain on Windows; we use `@libsql/client`
  (prebuilt) with the Drizzle `libsql` driver. Same SQLite semantics (WAL,
  FKs, busy timeout).
- `discover_profiles` consumes candidate lists (seed or an upstream scraper
  job). The Instagram-side scraping of keyword/hashtag/related-profile signals
  is a browser job to be filled in on top of the existing CDP driver.
