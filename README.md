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
    api/auth/     Better Auth endpoints (sign-in, sign-out, reset, …)
    login/        invite-only sign-in form
    accept-invite/ set name + password to activate an invited account
  domains/        pure decision cores — NO framework/DB/network imports
    health/       example core + unit test
    authz/        Principal (internal|client discriminated union) + tests
    identity/     invite eligibility rules + tests
  lib/            thin adapters (Prisma client, Better Auth, notifications, …)
    identity/     invite/user lifecycle, token hashing, current-principal resolver
worker/           Graphile Worker (background jobs) — uses DIRECT_URL
scripts/          one-off scripts (db smoke test, seed-admin)
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

## Identity & auth (issue #3)

Invite-only email/password, app-owned via Better Auth in our own Postgres
(ADR-0005), with database-backed sessions (ADR-0006) and an identity model that
is SSO-ready by construction (ADR-0007). There is **no public sign-up** — every
account is created by accepting an Admin invite.

Bootstrap the very first Admin (one-shot; refuses to run if an Admin already
exists):

```bash
# set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (≥12 chars) in .env first
npm run seed:admin
```

Then sign in at `/login` and invite the rest of the team. The flow:

- An **Admin** invites a user — either internal (with a role: Admin,
  Engagement Manager, Researcher, Analyst) or a **Client User** (bound to one
  Client/tenant). Internal staff are never tenant-scoped.
- The invitee gets a link to `/accept-invite`, sets a password, and the account
  activates. Accepting the invite **is** the email verification — no separate
  step. Invites are single-use and expire after `INVITE_EXPIRY_DAYS` (default 7).
- Offboarding is reversible **deactivation, never deletion**; deactivating a user
  deletes their sessions so access ends immediately. Password reset likewise
  revokes existing sessions, and deactivated accounts cannot reset.

The authenticated `Principal` (a discriminated union, illegal states forbidden by
both the type and a DB CHECK constraint) is resolved per request by
`getCurrentPrincipal()` — the seam the Authorization & Visibility layer (#4)
consumes.

Better Auth needs `BETTER_AUTH_SECRET` (a 32-byte random string) and
`BETTER_AUTH_URL` in `.env` — see `.env.example`.

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
