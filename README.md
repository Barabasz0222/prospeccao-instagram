# BraszTech — Autonomous Instagram Prospecting

Local, self-contained system that runs the loop
**observe → decide → act → measure → learn → adapt** for BraszTech's Instagram
prospecting, fully autonomously within the limits set in `.env` and the panel.
Outside those limits it pauses and calls the operator.

- **Operator manual (PT-BR):** [`SETUP.md`](./SETUP.md)
- **Architecture (dev, EN):** [`docs/architecture.md`](./docs/architecture.md)

## Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind · SQLite
via libsql + Drizzle ORM (versioned migrations) · Node 22 LTS · pnpm ·
Playwright (CDP) · official Anthropic SDK.

Modular monolith. The panel and the worker live in one repo and start with one
command. SQLite is the single source of truth; a durable `jobs` table replaces
Redis.

## Quick start

```bash
pnpm install
cp .env.example .env                       # fill in — see SETUP.md
cp config/business.example.json config/business.json
pnpm db:migrate
pnpm dev                                    # panel :3000 + worker
```

Demo data + explore the panel without sending anything:

```bash
pnpm tsx scripts/seed-demo.ts
```

End-to-end flow in simulation (no real Chrome, no real API):

```bash
pnpm tsx scripts/e2e-sim.ts
```

## Checks

```bash
pnpm check      # lint + typecheck + test + production build
```

## Layout

```
config/business.json          identity, offer, ICP, claims (gitignored)
src/app                       Next.js panel (PT-BR) + webhook route handler
src/features/{leads,conversations,dashboard,settings,...}
src/integrations/{instagram,browser,openai,whatsapp}
src/db                        schema, migrations, queries
src/worker                    durable jobs, rate limiting, safety trips
src/lib                       env, business config, states, claims guard, ...
```

## Safety model

- **Verified-claims guard** (`src/lib/claims.ts`): outbound text may only assert
  what's in `verifiedClaims`. Paraphrases of `unverifiedClaims`, invented
  rates/guarantees/superlatives, and promises of account approval or financial
  results are blocked before sending.
- **Channel lock**: the browser and the official API can never both send on the
  same thread. Ownership transfers browser → API on the first inbound reply.
- **Rate & health**: daily DM cap, randomized 90–240s spacing, operating-hours
  window, warmup ramp. A circuit breaker pauses the whole system on an abnormal
  failure rate, lost session, budget overrun, or browser/API/CRM divergence.
- **`do_not_contact`** is permanent and absorbing across every funnel and
  channel.
- All internal values are English; the entire operator UI is PT-BR.
