-- Issue #108 / ADR-0032: split the single free-text "Dealer location" into a
-- validated Dealer Country (canonical ISO 3166-1 short name) and a renamed
-- free-text dealer locality.
--
-- The existing `sourceLocation` is RENAMED IN PLACE to `sourceLocality` so every
-- row's prior location text is preserved as its locality (no data loss). The new
-- `sourceCountry` is added NULLABLE: legacy rows (and their already-pinned
-- conversions) stay untouched until next edit — currency/country validation is
-- forward-only, on the write path only.

ALTER TABLE "market_quote" RENAME COLUMN "sourceLocation" TO "sourceLocality";
ALTER TABLE "market_quote" ADD COLUMN "sourceCountry" TEXT;
