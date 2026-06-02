# Identity is SSO-ready: authentication separated from the principal

v1 ships email/password only, but identity must accept SSO later **without rework** (PRD;
issue #3). The structural property that guarantees this — and the only thing "SSO-ready"
means here — is a clean separation between **how a user authenticates** and **who the user
is (the principal)**.

## The structure

- **User** = the principal. Stable internal id, email, the internal/client discriminated
  union (`kind` + role *or* tenant), and active status. **Holds no password.** This is what
  the authorization layer (issue #4) reads.
- **Credential / account** = the authentication method, in a separate row referencing a User.
  In v1 there is exactly one type — `password`. It carries the password hash and nothing about
  authority.

This is Better Auth's native **user ↔ account** split (ADR-0005), so we adopt rather than invent it.

## Why this is SSO-ready

Adding SSO later is **additive**: a new credential type (e.g. `oidc:<provider>`) pointing at the
**same User**, plus a login button. Because role, tenant binding, and status live on the User —
**never on the credential** — a federated login inherits identical authority with:

- no migration of the principal model or the authorization layer,
- no change to sessions (ADR-0006 sessions are minted the same way regardless of credential),
- no change to tenant isolation.

## The testable guarantee

"SSO-ready" reduces to one invariant a future reader can check: **role/tenant/status are
attributes of the User (principal), not of the credential.** As long as that holds, SSO is a new
authentication method bolted onto existing identities — not a reshaping of identity.

## Out of scope for v1

Actual SSO/OIDC wiring, provider configuration, and just-in-time provisioning of SSO users are
deferred. This ADR commits only to the *structure* that keeps them cheap to add.
