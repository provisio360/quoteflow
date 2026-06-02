# Database-backed opaque sessions over JWT

Authenticated sessions are carried as an **opaque, random session ID in an httpOnly,
Secure, SameSite=Lax cookie**, looked up server-side against a session table in our own
Postgres on every request. We do **not** use stateless JWTs. This is Better Auth's default
and is consistent with ADR-0005's app-owned auth stored in our Postgres.

Each request resolves the live session and reads the user's **current** role/tenant from the
database, rather than trusting claims baked into a token.

## Why

- **Revocation must be immediate.** Offboarding is reversible deactivation (never deletion):
  a deactivated staff member or removed Client User must lose access on their *next request*.
  With stateless JWTs a valid token keeps working until it expires; fixing that requires a
  server-side denylist — at which point we are doing per-request DB lookups anyway and have
  lost the JWT's only advantage.
- **Role and tenant are authorization-critical.** Absolute tenant isolation (issue #4) and the
  internal/client `Principal` discriminated union depend on reading the *current* role/tenant.
  A role change (e.g. Researcher → Analyst) or deactivation takes effect immediately when the
  session is the source of truth; a token would carry stale authority until re-issue.
- **Boring, portable, low-maintenance** (ADR-0005 ethos). Just rows in a Postgres we already
  hit every request — no JWT signing-key rotation, no denylist service, nothing extra for a
  non-engineer to babysit.

## Cost accepted

A per-request session lookup. Trivial at our scale and on a database every request already
touches. We give up stateless horizontal scaling of auth, which we do not need.

## Consequences / SSO

When SSO is added later (ADR-0005 keeps that door open), the **session mechanism is unaffected**:
a federated login still mints the same kind of server-side session. SSO changes how a user
*authenticates*, not how the session is *carried*.
