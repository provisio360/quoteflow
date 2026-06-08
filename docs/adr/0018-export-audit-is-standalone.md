# The internal export's audit is a standalone row, not the deferred audit log

The [[Internal Export]] (issue #15) must be **audited**, but the general audit
log it would naturally belong to is a separate, not-yet-built slice (#16/#42 —
the same one ADR-0015 and the schema comments defer quote/release history to).
Rather than block #15 on #16, we record each successful internal export as a
purpose-built `ExportAudit` row — **who, which tenant, which study, which export
type, when** — written inside #15's own boundary.

## What it records, and when

- Fields: `userId`, `clientId` (the exported tenant, denormalized so "who
  exported tenant X's data" is a direct query — an internal export crosses
  tenants), `studyId`, `exportType` (`internal`), `createdAt`.
- Written **after the workbook is successfully generated**, before the file is
  returned. An export that errored produced no bytes, so it logs nothing — the
  audit answers "who actually obtained this data," not "who attempted it."
- **Internal exports only.** A [[Client Export]] is a tenant pulling its own
  released data (no [[Client Price]], nothing cross-tenant) and is not a
  sensitive access worth auditing.

## Why not wait for the general audit log (#16/#42)

The acceptance criterion is concrete and self-contained; the general audit log
is a larger design about quote-lifecycle and release history. Coupling #15 to it
would stall a shippable slice on an unrelated one. A dedicated export-audit table
is a defensible standalone even after #16 lands — export access is a distinct
concern from entity-change history, and the two can coexist.

## Considered and rejected

- **Structured app-log line only (no table).** Cheapest, but not queryable and
  not a durable audit trail — fails the spirit of "audited."
- **Defer to #16/#42 and mark #15 blocked by it.** Rejected: #15 is only blocked
  by #14, and the export-audit need is satisfiable now without the general log's
  design.

## Consequences

- A new `ExportAudit` model exists **separate** from whatever #16/#42 eventually
  builds. A future engineer consolidating audit concerns will find it and may
  want to fold it in — that is fine, but it was deliberately shipped standalone,
  not an oversight.
- The audit write is part of the internal export's success path; a failure to
  write it fails the export (the access must not be silently unlogged).
