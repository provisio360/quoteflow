-- Warranty Offered? gate (ADR-0037): a Yes/No answer over the two warranty pairs,
-- stored as a tri-state nullable boolean (NULL = unanswered) like discountAvailable.
ALTER TABLE "quote_line" ADD COLUMN "warrantyOffered" BOOLEAN;

-- Backfill: a line that already carries any warranty value or unit was unambiguously
-- offered, so seed it true. A line with no warranty at all stays NULL (unanswered) —
-- it is genuinely ambiguous between "not offered" and "not yet answered", and NULL
-- correctly forces the researcher to answer before submit rather than fabricating a No.
UPDATE "quote_line"
SET "warrantyOffered" = true
WHERE "warranty1Value" IS NOT NULL
   OR "warranty1Unit" IS NOT NULL
   OR "warranty2Value" IS NOT NULL
   OR "warranty2Unit" IS NOT NULL;
