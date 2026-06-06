import { redirect } from "next/navigation";
import { requireInternalPage } from "@/lib/identity/page-guards";
import { canReviewQuote } from "@/domains/authz/quotes";
import { listReviewQueue } from "@/lib/quotes/repository";
import { ReviewQueue } from "./ReviewQueue";

const wrap = { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 1100, lineHeight: 1.5 } as const;

// The Analyst review queue (issue #11). A global, FIFO queue of every Submitted
// Quote across all studies/tenants — analysts are not tenant-scoped (CONTEXT.md:
// Analyst). Analyst-only: a non-Analyst internal user is bounced like any other
// unauthorised principal (ADR-0008 ethos — no 403 that confirms the page exists).
export default async function ReviewPage() {
  const principal = await requireInternalPage();
  if (!canReviewQuote(principal)) redirect("/studies");

  const items = await listReviewQueue(principal);

  return (
    <main style={wrap}>
      <h1>Review queue</h1>
      <p style={{ color: "#555" }}>
        {items.length === 0
          ? "No quotes awaiting review."
          : `${items.length} quote${items.length === 1 ? "" : "s"} awaiting review (oldest first).`}
      </p>
      <ReviewQueue items={items} />
    </main>
  );
}
