"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviseLineAction } from "@/lib/quotes/actions";
import type { RejectedLineView } from "@/lib/quotes/repository";

// The researcher's "Needs attention" surface (#139 / ADR-0038): a worklist of the
// researcher's own currently-Rejected Quote Lines. Each row is the landing target
// of the rejection Notification deep-link (`#line-<n>`, ADR-0031) AND carries the
// Revise affordance itself — the retired per-part grid used to host both (#143).
// Every row is, by construction, the viewer's own Rejected line (the read filters
// `createdById = me, state = Rejected`), so Revise is always valid; no per-row
// gate is needed. Revising returns the line to Draft, dropping it from here and
// surfacing it in the Drafts panel above. No Client Price is ever present (ADR-0003).

function RejectedRow({ line }: { line: RejectedLineView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function revise() {
    setMessage(null);
    startTransition(async () => {
      const result = await reviseLineAction(line.lineId);
      if (result.ok) router.refresh();
      else setMessage("reason" in result ? "This line can't be revised right now." : "Couldn't revise that line.");
    });
  }

  return (
    // `line-<n>` is the deep-link anchor a rejection Notification targets (ADR-0031),
    // so the author lands directly on the line to revise it.
    <li
      id={`line-${line.quoteLineNumber}`}
      style={{
        padding: "0.7rem 0.9rem",
        marginBottom: "0.5rem",
        borderRadius: 6,
        border: "1px solid #eee",
      }}
    >
      <div style={{ fontWeight: 600 }}>{line.itemLabel}</div>
      <div style={{ color: "#555" }}>
        {line.country} · market quote {line.marketQuoteNumber}, line {line.quoteLineNumber}
      </div>
      {line.reason && <div style={{ color: "#555" }}>Reason: {line.reason}</div>}
      <button
        type="button"
        onClick={revise}
        disabled={pending}
        style={{ padding: "0.3rem 0.8rem", marginTop: "0.4rem" }}
      >
        {pending ? "Revising…" : "Revise and resubmit"}
      </button>
      {message !== null && (
        <p role="alert" style={{ color: "#b00", margin: "0.3rem 0 0" }}>
          {message}
        </p>
      )}
    </li>
  );
}

export function RejectedLines({ lines }: { lines: readonly RejectedLineView[] }) {
  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.1rem" }}>Needs attention</h2>
      {lines.length === 0 ? (
        <p style={{ color: "#555" }}>Nothing needs your attention.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {lines.map((l) => (
            <RejectedRow key={l.lineId} line={l} />
          ))}
        </ul>
      )}
    </section>
  );
}
