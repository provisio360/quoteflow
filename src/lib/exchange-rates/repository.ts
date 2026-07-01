import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/tenant-context";
import type { Principal } from "@/domains/authz/principal";
import { canManageStudyRates } from "@/domains/authz/exchange-rates";
import { getStudy } from "@/lib/studies/repository";
import { recordAuditEvents } from "@/lib/audit/repository";
import { auditStudyRateSet } from "@/domains/audit/events";
import {
  validateRateInput,
  type RateSetInput,
  type RateValidationError,
} from "@/domains/exchange-rates/rates";

// Tenant-aware data-access adapter for the Study Exchange Rate table (#160,
// ADR-0041) — the ONLY sanctioned read/write path. Both reads and writes are
// gated to the study-setup pair (EM + Analyst); the pure rules live in
// src/domains/exchange-rates (validation) and src/domains/authz/exchange-rates
// (role). A set is an UPSERT BY KEY (study, currency, rateDate): an existing key
// updates its value — that IS "edit". A studyRateSet Audit Event is written on
// create and on value-change, atomically in the same transaction; an identical
// re-save is a no-op that writes nothing (mirrors the idempotent assign path).

/** Raised for permission / unknown-study failures (not user-supplied content). */
export class ExchangeRateAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExchangeRateAccessError";
  }
}

/** Raised when the submitted rate/currency/date fails validation. `code` is the
 *  pure core's typed reason, mapped to a message by the caller/UI. */
export class ExchangeRateValidationError extends Error {
  constructor(public readonly code: RateValidationError) {
    super(code);
    this.name = "ExchangeRateValidationError";
  }
}

/** One rate row projected for display. `rateDate` is the calendar day (YYYY-MM-DD)
 *  and `rate` a decimal string — both stringly-exact, no float on the boundary. */
export interface StudyRateView {
  readonly id: string;
  readonly currency: string;
  readonly rateDate: string;
  readonly rate: string;
}

export interface SetStudyRateResult {
  readonly rate: StudyRateView;
  /** False when the submitted value equalled the stored one — no audit written. */
  readonly changed: boolean;
}

/** The YYYY-MM-DD calendar day of a @db.Date column, read in UTC. */
function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toView(row: {
  id: string;
  currency: string;
  rateDate: Date;
  rate: Prisma.Decimal;
}): StudyRateView {
  return {
    id: row.id,
    currency: row.currency,
    rateDate: toDayString(row.rateDate),
    rate: row.rate.toString(),
  };
}

/**
 * Set (create or edit) one Study Exchange Rate row. Role-gated to EM + Analyst,
 * study resolved tenant-scoped (a principal can't write into a study it can't
 * see, ADR-0008). USD and malformed rate/date are refused
 * (ExchangeRateValidationError) and write nothing. Upsert by key; a value-change
 * or create writes a studyRateSet audit event, an identical re-save does not.
 */
export async function setStudyRate(
  principal: Principal,
  studyId: string,
  input: RateSetInput,
): Promise<SetStudyRateResult> {
  if (!canManageStudyRates(principal)) {
    throw new ExchangeRateAccessError(
      "Only Engagement Managers and Analysts may set study exchange rates",
    );
  }

  const validated = validateRateInput(input);
  if (!validated.ok) throw new ExchangeRateValidationError(validated.error);
  const { currency, rateDate, rate } = validated.value;

  return withTenant(principal, async (tx) => {
    const study = await getStudy(principal, studyId);
    if (study === null) {
      throw new ExchangeRateAccessError(`Study not found: ${studyId}`);
    }

    const rateDay = new Date(`${rateDate}T00:00:00.000Z`);
    const value = new Prisma.Decimal(rate);

    const existing = await tx.studyExchangeRate.findUnique({
      where: { studyId_currency_rateDate: { studyId, currency, rateDate: rateDay } },
    });

    // Identical re-save — no write, no audit (ADR-0019: one event per real change).
    if (existing !== null && existing.rate.equals(value)) {
      return { rate: toView(existing), changed: false };
    }

    const row = existing === null
      ? await tx.studyExchangeRate.create({
          data: {
            studyId,
            // Denormalized RLS tenant column (ADR-0021), copied from the study.
            clientId: study.clientId,
            currency,
            rateDate: rateDay,
            rate: value,
          },
        })
      : await tx.studyExchangeRate.update({
          where: { id: existing.id },
          data: { rate: value },
        });

    await recordAuditEvents(tx, [
      auditStudyRateSet({ actorId: principal.userId, studyId, rateId: row.id }),
    ]);

    return { rate: toView(row), changed: true };
  });
}

/**
 * The rate rows for a study, for the setup list. Role-gated to EM + Analyst
 * (Researchers reach this data only through later conversion slices) and tenant-
 * scoped. Ordered currency A→Z, then most-recent rateDate first.
 */
export async function listStudyRates(
  principal: Principal,
  studyId: string,
): Promise<StudyRateView[]> {
  if (!canManageStudyRates(principal)) {
    throw new ExchangeRateAccessError(
      "Only Engagement Managers and Analysts may read study exchange rates",
    );
  }

  return withTenant(principal, async (tx) => {
    const study = await getStudy(principal, studyId);
    if (study === null) {
      throw new ExchangeRateAccessError(`Study not found: ${studyId}`);
    }
    const rows = await tx.studyExchangeRate.findMany({
      where: { studyId },
      orderBy: [{ currency: "asc" }, { rateDate: "desc" }],
    });
    return rows.map(toView);
  });
}
