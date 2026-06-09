# Runbook: provisioning the RLS app-role login on Neon (issue #21 / ADR-0021)

The RLS migration (`20260609000000_rls_tenant_isolation`) creates the **group**
role `quoteflow_app` (NOLOGIN) and all the policies. It deliberately does **not**
create a LOGIN role with a password — secrets never live in committed SQL. This
runbook is the out-of-band step you run once per environment to create the real
login role, grant it into the group, and point the app at it.

All steps run against your Neon database. Use the Neon SQL editor or `psql` with
your **owner** connection (the `DIRECT_URL` role).

## 1. Apply the migration (creates the group role + policies)

```bash
npx prisma migrate deploy      # runs as the owner via DIRECT_URL
```

Verify the group role and policies exist:

```sql
SELECT rolname FROM pg_roles WHERE rolname = 'quoteflow_app';        -- 1 row
SELECT tablename FROM pg_policies WHERE policyname = 'tenant_isolation';
-- expect: study, benchmark_item, quote, country_assignment, country_release, client
```

## 2. Create the LOGIN role and grant it into the group

Pick a strong password (store it only as a deployment secret):

```sql
CREATE ROLE quoteflow_app_login LOGIN PASSWORD '<STRONG_PASSWORD>';
GRANT quoteflow_app TO quoteflow_app_login;
```

`quoteflow_app_login` inherits the group's CRUD grants but is **not** the table
owner and is **not** a superuser / BYPASSRLS — so the RLS policies apply to it.
(On Neon, confirm the login role did not inherit superuser; `\du` should show no
attributes beyond what you granted.)

> Naming note: the group is `quoteflow_app`; the login can be any name. If you
> prefer the login itself to be called `quoteflow_app`, create it `LOGIN` in
> step 2 instead of relying on the group — but keeping group/login separate lets
> you rotate the login credential without touching grants.

## 3. Point the app at the login role

Set `APP_DATABASE_URL` to the **pooled** connection string (hostname contains
`-pooler`) for `quoteflow_app_login`:

```
APP_DATABASE_URL="postgresql://quoteflow_app_login:<STRONG_PASSWORD>@ep-xxxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require"
```

Leave `DATABASE_URL` (owner, pooled) and `DIRECT_URL` (owner, direct — migrations
and the worker) as they are. The worker intentionally stays on the owner and
bypasses RLS (ADR-0021).

## 4. Verify enforcement

With `APP_DATABASE_URL` set, the RLS proof test runs (it otherwise skips):

```bash
npm run test:integration -- src/lib/rls/isolation.integration.test.ts
```

It proves a raw query as the app role cannot cross tenants, fails closed with no
context, and that internal staff see all.

## ⚠️ Set `APP_DATABASE_URL` on the WEB app only — never the worker

All request-serving repositories now run inside `withTenant`, so flipping the web
app to the app-role connection is safe. But the **background worker must stay on
the owner connection**: it is a cross-tenant system actor (the FX sweep in
`quotes/conversion-fill`, the email step in `notifications/send`) that bypasses
RLS by design (ADR-0021). Those paths use `prisma` with no tenant GUC.

If the worker process is given `APP_DATABASE_URL`, it will connect as the
non-owner role and those reads will **fail closed to zero rows** — the FX sweep
would silently stop pinning rates and notification emails would lose their study
name. On Railway/Render the app and worker are separate services with separate
env; set `APP_DATABASE_URL` on the **web service only**.

| Service | Connection | RLS |
|---|---|---|
| Web app | `APP_DATABASE_URL` (non-owner `quoteflow_app_login`, pooled) | enforced |
| Worker  | `DIRECT_URL` / `DATABASE_URL` (owner) — `APP_DATABASE_URL` UNSET | bypassed (by design) |
| Migrations | `DIRECT_URL` (owner) | bypassed |

That is the whole rollout — there is no remaining wiring step.
