import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { Principal } from "@/domains/authz/principal";
import { tenantVisibility } from "@/domains/authz/visibility";
import { visibilityWhere } from "@/lib/studies/where";
import { buildClientExport, type ClientExportItem } from "@/domains/export/client-export";
import { buildInternalExport, type InternalExportQuote } from "@/domains/export/internal-export";
import { renderWorkbook } from "./render";

// Tenant-aware data-access adapter for the exports (issue #15). It owns what the
// pure builders (src/domains/export) can't: scoping the read to a single study,
// the tenant gate (Client Export) vs the Analyst+EM gate (Internal Export), the
// released/approved vs all-non-Draft populations, Decimal→number marshalling, and
// the ExportAudit write (ADR-0018). The column/row shaping and the QC-flag maths
// live in the pure cores; rendering to .xlsx lives in ./render.

/** Raised when a principal may not run the Internal Export (a Researcher, Admin,
 *  or Client User). A wrong-tenant Client Export is NOT an error — it yields an
 *  empty workbook, mirroring the dashboard read (ADR-0008). */
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

const CLIENT_ITEM_SELECT = {
  country: true,
  clientPartNumber: true,
  itemDescription: true,
  quotes: {
    where: { state: "Approved" as const },
    orderBy: { quoteNumber: "asc" as const },
    select: {
      quoteNumber: true,
      competitorBrand: true,
      dealerName: true,
      dealerLocation: true,
      price: true,
      currency: true,
      quantityQuoted: true,
      convertedUsdPrice: true,
      convertedUsdPricePerUnit: true,
      stockStatus: true,
      leadTime: true,
      warranty: true,
      discount: true,
      notes: true,
    },
  },
} as const;

/**
 * The Client Export (CONTEXT.md): the released + approved data a Client User
 * downloads of their own tenant. Tenant-gated — an out-of-tenant or unknown study
 * yields an empty workbook (never another tenant's data, ADR-0008). Carries NO
 * Client Price (ADR-0003).
 */
export async function exportClientWorkbook(
  principal: Principal,
  studyId: string,
): Promise<Buffer> {
  const study = await scopedStudy(principal, studyId);
  const items: ClientExportItem[] = study === null ? [] : await loadReleasedItems(studyId);
  return renderWorkbook(buildClientExport(items));
}

/** Load every Benchmark Item in a study's CURRENTLY-released countries with its
 *  Approved quotes nested. Same population as the client dashboard (ADR-0017). */
async function loadReleasedItems(studyId: string): Promise<ClientExportItem[]> {
  const released = await prisma.countryRelease.findMany({
    where: { studyId, state: "released" },
    select: { country: true },
  });
  if (released.length === 0) return [];

  const rows = await prisma.benchmarkItem.findMany({
    where: { studyId, country: { in: released.map((r) => r.country) } },
    orderBy: [{ country: "asc" }, { clientPartNumber: "asc" }],
    select: CLIENT_ITEM_SELECT,
  });

  return rows.map((row) => ({
    country: row.country,
    clientPartNumber: row.clientPartNumber,
    itemDescription: row.itemDescription,
    quotes: row.quotes.map((q) => ({
      quoteNumber: q.quoteNumber,
      competitorBrand: q.competitorBrand,
      dealerName: q.dealerName,
      dealerLocation: q.dealerLocation,
      price: toNumber(q.price),
      currency: q.currency,
      quantityQuoted: q.quantityQuoted,
      convertedUsdPrice: toNumber(q.convertedUsdPrice),
      usdPricePerUnit: toNumber(q.convertedUsdPricePerUnit),
      stockStatus: q.stockStatus,
      leadTime: q.leadTime,
      warranty: q.warranty,
      discount: q.discount,
      notes: q.notes,
    })),
  }));
}

const INTERNAL_ITEM_SELECT = {
  country: true,
  clientPartNumber: true,
  itemDescription: true,
  clientPrice: true,
  quotes: {
    where: { NOT: { state: "Draft" as const } },
    orderBy: { quoteNumber: "asc" as const },
    select: {
      state: true,
      quoteNumber: true,
      competitorBrand: true,
      dealerName: true,
      dealerLocation: true,
      price: true,
      currency: true,
      quantityQuoted: true,
      convertedUsdPrice: true,
      convertedUsdPricePerUnit: true,
      stockStatus: true,
      leadTime: true,
      warranty: true,
      discount: true,
      notes: true,
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

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: { clientId: true, qcThresholdPct: true, benchmarkItems: { orderBy: [{ country: "asc" }, { clientPartNumber: "asc" }], select: INTERNAL_ITEM_SELECT } },
  });
  if (study === null) throw new ExportAccessError("Study not found");

  const quotes: InternalExportQuote[] = [];
  for (const item of study.benchmarkItems) {
    for (const q of item.quotes) {
      quotes.push({
        country: item.country,
        clientPartNumber: item.clientPartNumber,
        itemDescription: item.itemDescription,
        clientPrice: toNumber(item.clientPrice),
        state: q.state,
        quoteNumber: q.quoteNumber,
        competitorBrand: q.competitorBrand,
        dealerName: q.dealerName,
        dealerLocation: q.dealerLocation,
        price: toNumber(q.price),
        currency: q.currency,
        quantityQuoted: q.quantityQuoted,
        convertedUsdPrice: toNumber(q.convertedUsdPrice),
        usdPricePerUnit: toNumber(q.convertedUsdPricePerUnit),
        stockStatus: q.stockStatus,
        leadTime: q.leadTime,
        warranty: q.warranty,
        discount: q.discount,
        notes: q.notes,
        justification: q.justification,
        rejectionReason: q.rejectionReason,
      });
    }
  }

  const buffer = await renderWorkbook(
    buildInternalExport(quotes, study.qcThresholdPct.toNumber()),
  );

  // Audit AFTER successful generation (ADR-0018): a failed export logs nothing.
  await prisma.exportAudit.create({
    data: { userId: principal.userId, clientId: study.clientId, studyId, exportType: "internal" },
  });

  return buffer;
}

/** Filter-first tenant lookup: an out-of-tenant or unknown study collapses to
 *  null → an empty client workbook (ADR-0008). */
async function scopedStudy(principal: Principal, studyId: string) {
  return prisma.study.findFirst({
    where: { AND: [visibilityWhere(tenantVisibility(principal)), { id: studyId }] },
    select: { id: true },
  });
}

/** Prisma Decimal → number (or null), for the pure builders' plain-number cells. */
function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}
