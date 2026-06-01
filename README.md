# QuoteFlow

Multi-tenant platform for running pricing studies. See [`CONTEXT.md`](./CONTEXT.md)
for the domain glossary, [`docs/adr/`](./docs/adr/) for decisions, and
[`docs/prd/quoteflow-v1.md`](./docs/prd/quoteflow-v1.md) for the v1 PRD.

The stack and its rationale are recorded in
[ADR-0005](./docs/adr/0005-v1-tech-stack.md): a portable TypeScript modular
monolith (Next.js + Neon Postgres + Prisma + Graphile Worker), with load-bearing
domain logic kept in framework-agnostic `src/domains/*` packages.

## Layout

```
src/
  app/            Next.js App Router (web + adapter layer)
    api/health/   end-to-end health probe (DB round-trip)
  domains/        pure decision cores — NO framework/DB/network imports
    health/       example core + unit test
  lib/            thin adapters (Prisma client, …)
worker/           Graphile Worker (background jobs) — uses DIRECT_URL
scripts/          one-off scripts (db smoke test)
prisma/           schema + migrations
```

**The rule:** `src/domains/*` stays pure and unit-tested (Vitest). Everything
that touches the database, network, or framework is a thin adapter around it.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Configure environment** — copy the template and fill in your Neon
   connection strings (`.env` is gitignored):
   ```bash
   cp .env.example .env
   ```
   - `DATABASE_URL` — Neon **pooled** connection (hostname contains `-pooler`)
   - `DIRECT_URL` — same connection **without** `-pooler` (used for migrations)
3. **Generate the Prisma client and apply migrations**
   ```bash
   npm run prisma:generate
   npm run db:migrate
   ```

## Run

```bash
npm run dev          # web app at http://localhost:3000
npm run worker       # background worker (separate process)
```

Visit <http://localhost:3000/api/health> — it writes and reads a row through
Prisma and returns `{ "status": "ok", ... }` when the database is reachable.

## Verify

```bash
npm run test         # Vitest — pure domain cores
npm run typecheck    # tsc --noEmit
npm run db:smoke     # prove a DB write+read round-trip to Neon
npm run worker:once  # enqueue + process one background job, then exit
```

CI (`.github/workflows/ci.yml`) runs install → prisma generate → typecheck →
tests on every push and PR. The DB-backed checks (`db:smoke`, `worker:once`) are
run locally since they need a live database.
