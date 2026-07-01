-- Issue #161 / ADR-0041: wire the Study Exchange Rate table into Market Quote
-- conversion. A table hit pins at submit with a new `study-rate` provenance,
-- ahead of the deferred worker sweep.

-- The fourth ConversionStatus provenance. The Prisma enum member is `studyRate`
-- (members can't hold a hyphen); the persisted/wire value stays the documented
-- `study-rate`. Additive ADD VALUE — safe, and unused in this migration's own SQL.
ALTER TYPE "ConversionStatus" ADD VALUE 'study-rate';
