import { NextResponse, type NextRequest } from "next/server";
import { requirePrincipal, PrincipalError } from "@/lib/identity/current-principal";
import {
  exportClientWorkbook,
  exportInternalWorkbook,
  ExportAccessError,
} from "@/lib/export/repository";

export const dynamic = "force-dynamic";

// Delivery for the study exports (issue #15): a binary .xlsx download, which fits
// a route handler far better than a server action. `?type=client|internal`
// chooses the flavour; the repository owns authorization, the tenant/role gate,
// the read population, and the ExportAudit write (ADR-0018). This layer only
// resolves the caller, dispatches, and streams the bytes back.

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: studyId } = await params;
  const type = request.nextUrl.searchParams.get("type") ?? "client";

  let principal;
  try {
    principal = await requirePrincipal();
  } catch (err) {
    if (err instanceof PrincipalError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    throw err;
  }

  if (type !== "client" && type !== "internal") {
    return NextResponse.json(
      { error: "Unknown export type; use ?type=client or ?type=internal" },
      { status: 400 },
    );
  }

  try {
    const buffer =
      type === "internal"
        ? await exportInternalWorkbook(principal, studyId)
        : await exportClientWorkbook(principal, studyId);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="study-${studyId}-${type}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ExportAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
