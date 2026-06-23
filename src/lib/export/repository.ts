import { prisma } from "@/lib/prisma";
import { withTenant, type TenantClient } from "@/lib/tenant-context";
import type { Prisma } from "@prisma/client";
import type { Principal } from "@/domains/authz/principal";
import { tenantVisibility } from "@/domains/authz/visibility";
import { visibilityWhere } from "@/lib/studies/where";
import { buildClientExport, type ClientExportItem } from "@/domains/export/client-export";
import { buildInternalExport, type InternalExportLine } from "@/domains/export/internal-export";
import { renderWorkbook } from "./render";

// Tenant-aware data-access adapter for the exports (issue #15). It owns what the
// pure builders (src/domains/export) can't: scoping the read to a single study,
// the tenant gate (Client Export) vs the Analyst+EM gate (Internal Export), the
// released/approved vs all-non-Draft populations, Decimal→number marshalling, and
// the ExportAudit write (ADR-0018). The column/row shaping and the QC-flag maths
// live in the pure cores; rendering to .xlsx lives in ./render.

/** Raised when a principal may not run an export: a Researcher, Admin, or Client
 *  User on the Internal Export, or a Researcher on the Client Export (#64). A
 *  wrong-tenant Client Export is NOT an error — it yields an empty workbook,
 *  mirroring the dashboard read (ADR-0008). */
export class ExportAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportAccessError";
  }
}

/** Internal Export gate: only an Analyst or Engagement Manager (CONTEXT.md:
 *  Internal Export). Never a Researcher (Client Price hidden, ADR-0003), an Admin
 *  (user-administration only), or a Client User. */
function mayRunInternalExport(principal: Principal): boolean {
  return (
    principal.kind === "internal" &&
    (principal.role === "Analyst" || principal.role === "EngagementManager")
  );
}

/** Client Export gate (#64): a Client User (own tenant) or any internal staff
 *  EXCEPT a Researcher. The Researcher block is the load-bearing rule — the
 *  Client Export carries no Client Price (ADR-0003), but the released "answer"
 *  workbook is a side door around the assigned-country boundary (#62, ADR-0025)
 *  and must fail closed, extending ADR-0003's anti-anchoring ethos exactly as
 *  the client dashboard does (#63). EM/Analyst/Admin pulling the client's own
 *  output is a retained affordance. */
function mayRunClientExport(principal: Principal): boolean {
  return (
    principal.kind === "client" ||
    (principal.kind === "internal" && principal.role !== "Researcher")
  );
}

// The full line + parent-document field set both exports read, reshaped to the
// real artifact columns (ADR-0029, #93). The parent Market Quote is joined for the
// document facts (number, source, currency, date, rate); the structured line
// fields (lead time, two warranties, discount flags, landed cost, two notes) map
// straight onto the artifact's split value/unit columns.
const LINE_EXPORT_SELECT = {
  quoteLineNumber: true,
  competitorBrand: true,
  competitorPartNumber: true,
  competitorPartDescription: true,
  price: true,
  quantityQuoted: true,
  convertedUsdPrice: true,
  convertedUsdPricePerUnit: true,
  stockStatus: true,
  leadTimeValue: true,
  leadTimeUnit: true,
  warranty1Value: true,
  warranty1Unit: true,
  warranty2Value: true,
  warranty2Unit: true,
  discountAvailable: true,
  discountApplied: true,
  discountValue: true,
  discountType: true,
  landedCostIncluded: true,
  landedCostNote: true,
  notes: true,
  notesSecondary: true,
  confidenceCode: true,
  paperQuote: true,
  marketQuote: {
    select: {
      marketQuoteNumber: true,
      sourceName: true,
      sourceLocation: true,
      sourceUrl: true,
      currency: true,
      dateQuoteReceived: true,
      exchangeRate: true,
    },
  },
} as const;

// The Benchmark Item context the artifact rows carry (the client-item columns),
// shared by both exports; the Internal Export additionally reads the Client Price.
const ITEM_EXPORT_SELECT = {
  country: true,
  clientCategory: true,
  clientSourceUnit: true,
  sourceUnitIdentifier: true,
  clientItemOffering: true,
  itemDescription: true,
  itemSecondaryDescription: true,
  quantity: true,
  clientItemNumber: true,
  clientSecondaryItemNumber: true,
  configurationComment: true,
} as const;

const CLIENT_ITEM_SELECT = {
  ...ITEM_EXPORT_SELECT,
  quoteLines: {
    where: { state: "Approved" as const },
    orderBy: { quoteLineNumber: "asc" as const },
    select: LINE_EXPORT_SELECT,
  },
} as const;

/**
 * The Client Export (CONTEXT.md): the released + approved data a Client User
 * downloads of their own tenant. Gated against the Researcher (#64): the released
 * "answer" view is a side door around their assigned-country boundary, so they are
 * refused up-front — a hard 403, like the Internal Export's role gate — rather than
 * the soft empty-workbook tenant miss. Otherwise tenant-gated — an out-of-tenant or
 * unknown study yields an empty workbook (never another tenant's data, ADR-0008).
 * Carries NO Client Price (ADR-0003). Unaudited (a tenant pulling its own data).
 */
export async function exportClientWorkbook(
  principal: Principal,
  studyId: string,
): Promise<Buffer> {
  if (!mayRunClientExport(principal)) {
    throw new ExportAccessError("Only a Client User, Engagement Manager, Analyst, or Admin may run the client export");
  }

  const result = await withTenant(principal, async (tx) => {
    const study = await scopedStudy(tx, principal, studyId);
    if (study === null) return { name: "", items: [] as ClientExportItem[] };
    return { name: study.name, items: await loadReleasedItems(tx, studyId) };
  });
  return renderWorkbook(buildClientExport(result.name, result.items));
}

/** Load every Benchmark Item in a study's CURRENTLY-released countries with its
 *  Approved quotes nested. Same population as the client dashboard (ADR-0017). */
async function loadReleasedItems(
  tx: TenantClient,
  studyId: string,
): Promise<ClientExportItem[]> {
  const released = await tx.countryRelease.findMany({
    where: { studyId, state: "released" },
    select: { country: true },
  });
  if (released.length === 0) return [];

  const rows = await tx.benchmarkItem.findMany({
    where: { studyId, country: { in: released.map((r) => r.country) } },
    orderBy: [{ country: "asc" }, { clientItemNumber: "asc" }],
    select: CLIENT_ITEM_SELECT,
  });

  return rows.map((row) => ({
    market: row.country,
    clientCategory: row.clientCategory,
    clientSourceUnit: row.clientSourceUnit,
    clientSourceUnitIdentifier: row.sourceUnitIdentifier,
    clientItemOffering: row.clientItemOffering,
    clientItemDescription: row.itemDescription,
    clientItemSecondaryDescription: row.itemSecondaryDescription,
    clientItemQuantity: row.quantity,
    clientItemNumber: row.clientItemNumber,
    clientSecondaryItemNumber: row.clientSecondaryItemNumber,
    clientItemConfigurationComment: row.configurationComment,
    quotes: row.quoteLines.map((q) => ({
      rowId: q.quoteLineNumber,
      marketQuoteNumber: q.marketQuote.marketQuoteNumber,
      sourceName: q.marketQuote.sourceName,
      sourceLocation: q.marketQuote.sourceLocation,
      sourceUrl: q.marketQuote.sourceUrl,
      competitorBrand: q.competitorBrand,
      competitorItemDescription: q.competitorPartDescription,
      competitorItemQuantity: q.quantityQuoted,
      competitorItemNumber: q.competitorPartNumber,
      dateQuoteReceived: fmtDate(q.marketQuote.dateQuoteReceived),
      currencyTypeQuoted: q.marketQuote.currency,
      quotedPrice: toNumber(q.price),
      currencyExchangeRate: toNumber(q.marketQuote.exchangeRate),
      convertedPrice: toNumber(q.convertedUsdPrice),
      convertedPricePerUnit: toNumber(q.convertedUsdPricePerUnit),
      stockStatus: q.stockStatus,
      shippingLeadTimeValue: toNumber(q.leadTimeValue),
      shippingLeadTimeUnit: q.leadTimeUnit,
      landedCostIncluded: q.landedCostIncluded,
      landedCostNote: q.landedCostNote,
      warranty1Value: toNumber(q.warranty1Value),
      warranty1Unit: q.warranty1Unit,
      warranty2Value: toNumber(q.warranty2Value),
      warranty2Unit: q.warranty2Unit,
      discountAvailable: q.discountAvailable,
      discountApplied: q.discountApplied,
      discountValue: toNumber(q.discountValue),
      discountType: q.discountType,
      otherNotes1: q.notes,
      otherNotes2: q.notesSecondary,
      confidenceCode: q.confidenceCode,
    })),
  }));
}

const INTERNAL_ITEM_SELECT = {
  ...ITEM_EXPORT_SELECT,
  clientPrice: true,
  quoteLines: {
    where: { NOT: { state: "Draft" as const } },
    orderBy: { quoteLineNumber: "asc" as const },
    select: {
      ...LINE_EXPORT_SELECT,
      state: true,
      justification: true,
      rejectionReason: true,
    },
  },
} as const;

/**
 * The Internal Export (CONTEXT.md): every non-Draft Quote in a study across all
 * countries, with Client Price, QC Flag, and Justification. Gated to Analyst + EM
 * (ADR-0003); a Researcher, Admin, or Client User is refused. A successful export
 * writes an ExportAudit row AFTER the bytes are produced (ADR-0018).
 */
export async function exportInternalWorkbook(
  principal: Principal,
  studyId: string,
): Promise<Buffer> {
  if (!mayRunInternalExport(principal)) {
    throw new ExportAccessError("Only an Analyst or Engagement Manager may run the internal export");
  }

  const study = await withTenant(principal, (tx) =>
    tx.study.findUnique({
      where: { id: studyId },
      select: { name: true, clientId: true, qcThreshold: true, benchmarkItems: { orderBy: [{ country: "asc" }, { clientItemNumber: "asc" }], select: INTERNAL_ITEM_SELECT } },
    }),
  );
  if (study === null) throw new ExportAccessError("Study not found");

  const lines: InternalExportLine[] = [];
  for (const item of study.benchmarkItems) {
    for (const q of item.quoteLines) {
      lines.push({
        rowId: q.quoteLineNumber,
        market: item.country,
        marketQuoteNumber: q.marketQuote.marketQuoteNumber,
        clientCategory: item.clientCategory,
        clientSourceUnit: item.clientSourceUnit,
        clientSourceUnitIdentifier: item.sourceUnitIdentifier,
        clientItemOffering: item.clientItemOffering,
        clientItemDescription: item.itemDescription,
        clientItemSecondaryDescription: item.itemSecondaryDescription,
        clientItemQuantity: item.quantity,
        clientItemNumber: item.clientItemNumber,
        clientSecondaryItemNumber: item.clientSecondaryItemNumber,
        clientItemConfigurationComment: item.configurationComment,
        sourceName: q.marketQuote.sourceName,
        sourceLocation: q.marketQuote.sourceLocation,
        sourceUrl: q.marketQuote.sourceUrl,
        competitorBrand: q.competitorBrand,
        competitorItemDescription: q.competitorPartDescription,
        competitorItemQuantity: q.quantityQuoted,
        competitorItemNumber: q.competitorPartNumber,
        dateQuoteReceived: fmtDate(q.marketQuote.dateQuoteReceived),
        currencyTypeQuoted: q.marketQuote.currency,
        quotedPriceTotal: toNumber(q.price),
        currencyExchangeRate: toNumber(q.marketQuote.exchangeRate),
        convertedPrice: toNumber(q.convertedUsdPrice),
        convertedPricePerUnit: toNumber(q.convertedUsdPricePerUnit),
        clientItemPriceUsd: toNumber(item.clientPrice),
        stockStatus: q.stockStatus,
        shippingLeadTimeValue: toNumber(q.leadTimeValue),
        shippingLeadTimeUnit: q.leadTimeUnit,
        landedCostIncluded: q.landedCostIncluded,
        landedCostNote: q.landedCostNote,
        warranty1Value: toNumber(q.warranty1Value),
        warranty1Unit: q.warranty1Unit,
        warranty2Value: toNumber(q.warranty2Value),
        warranty2Unit: q.warranty2Unit,
        discountAvailable: q.discountAvailable,
        discountApplied: q.discountApplied,
        discountValue: toNumber(q.discountValue),
        discountType: q.discountType,
        otherNotes1: q.notes,
        otherNotes2: q.notesSecondary,
        confidenceCode: q.confidenceCode,
        paperQuote: q.paperQuote,
        state: q.state,
        justification: q.justification,
        rejectionReason: q.rejectionReason,
      });
    }
  }

  const buffer = await renderWorkbook(
    buildInternalExport(study.name, lines, study.qcThreshold.toNumber()),
  );

  // Audit AFTER successful generation (ADR-0018): a failed export logs nothing.
  await prisma.exportAudit.create({
    data: { userId: principal.userId, clientId: study.clientId, studyId, exportType: "internal" },
  });

  return buffer;
}

/** Filter-first tenant lookup: an out-of-tenant or unknown study collapses to
 *  null → an empty client workbook (ADR-0008). */
async function scopedStudy(tx: TenantClient, principal: Principal, studyId: string) {
  return tx.study.findFirst({
    where: { AND: [visibilityWhere(tenantVisibility(principal)), { id: studyId }] },
    select: { id: true, name: true },
  });
}

/** Prisma Decimal → number (or null), for the pure builders' plain-number cells. */
function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

/** A pinned Date Quote Received → the artifact's bare `YYYY-MM-DD` string. The
 *  date is stored at UTC midnight (CONTEXT.md: Exchange Rate), so the UTC slice is
 *  the calendar day the dealer quoted; formatting here keeps the pure builders
 *  free of timezone concerns (ADR-0029). */
function fmtDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}
