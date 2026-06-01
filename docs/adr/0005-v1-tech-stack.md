# v1 tech stack: a portable TypeScript modular monolith

QuoteFlow v1 is built primarily by an AI agent working unattended, steered by a product owner with no software-engineering background and no team. That single fact, more than any benchmark, drives the stack: we optimise for **agent-buildability** (mainstream, heavily-documented choices the agent produces reliably), **operability by a non-engineer** (managed services, nothing to babysit), and **no painting-into-a-corner** (boring, portable choices a future hire would also reach for). Two owner constraints narrow it further: *cheap but not fragile* (managed where it de-risks ops, frugal elsewhere) and *portability matters* (stay on standard Postgres and portable patterns; avoid lock-in). There are no client data-residency requirements yet, and portability keeps that door open without paying for it now.

We build a **modular monolith in TypeScript** — one deployable app plus one background worker — not microservices. This maps directly onto the PRD's thesis of deep modules with pure decision-logic cores and thin adapters: the load-bearing rules live in framework-agnostic `domains/*` packages (`quotes`, `release`, `import`, `fx`, `authz`, `audit`, `analytics`), unit-tested with no database or network, while web/DB/HTTP are thin adapters around them. Framework internals never touch the important code.

The chosen components:

- **Web framework:** Next.js (App Router), React, TypeScript — the most heavily-represented modern web stack, so agent output is most reliable.
- **Database:** Neon (managed PostgreSQL) — pure Postgres (portable), generous free tier, scale-to-zero (cheap at low usage), and database branching, which is valuable when the agent tests migrations unattended.
- **Persistence/ORM:** Prisma — robust migrations and a `schema.prisma` file the owner can actually read to understand the domain.
- **Validation:** Zod — shared between import validation and forms; feeds the pure validator cores.
- **Auth:** Better Auth, app-owned, stored in our own Postgres — invite-only email/password with roles and tenant binding built in, SSO addable later, no per-user vendor fees.
- **Authorization:** the app-layer Authorization & Visibility module (pure predicates, per the PRD) is primary; PostgreSQL Row-Level Security is a defense-in-depth backstop, never the only layer.
- **Background jobs:** Graphile Worker — a queue that runs inside the Neon database, satisfying ADR-0004's pending-FX-fill worker with no Redis and no extra vendor.
- **UI:** Tailwind CSS + shadcn/ui, TanStack Table, React Hook Form — battle-tested for dense internal-tool dashboards.
- **Import/export:** SheetJS for spreadsheet ingest and CSV/Excel export; Playwright for HTML→PDF.
- **Object storage:** Cloudflare R2 (S3-compatible, no egress fees) for the original uploaded spreadsheet kept as evidence — swappable behind the import/export adapter.
- **Email:** Resend, behind the Notifications adapter (rejection → researcher, release → client).
- **Hosting:** Railway (or Render) — runs the Next.js app and the durable worker in one place; it is just a container, redeployable elsewhere.
- **Testing:** Vitest for the pure domain cores, Playwright for role/workflow integration — exactly the PRD's split.

We deliberately **diverged from the generic "2026 SaaS" template** the research surfaced, in each case because of the owner constraints above. We rejected the **full Supabase platform** in favour of Neon: Supabase's value-add is its Auth/Storage/auto-APIs, which are precisely the lock-in vectors, and the PRD keeps authorization in the app anyway — strip those away and Supabase's advantages over plain Postgres evaporate. We rejected **Redis + BullMQ and hosted job runners (Trigger.dev/Inngest)** in favour of a Postgres-backed queue: a queue inside the database we already run is cheaper, more portable, and one fewer fragile thing for a non-engineer to maintain. We rejected **Vercel** in favour of Railway/Render because Vercel is serverless and does not run the long-lived background worker ADR-0004 requires well, forcing a separate job vendor; a single platform hosting both the app and the worker is simpler and less locked-in. We rejected **Clerk / Supabase Auth** in favour of app-owned Better Auth for portability and to avoid per-active-user fees, accepting that we then own the auth-security surface.

The shape is intended to last well beyond v1. If an enterprise client later mandates a specific cloud or region, standard Postgres plus a containerised app migrate to it; if auth needs grow, SSO slots into Better Auth; if any single managed service disappoints, each was chosen to be replaceable behind an adapter or because it is standard Postgres underneath.
