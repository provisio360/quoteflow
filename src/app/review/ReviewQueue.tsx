"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveQuoteAction, rejectQuoteAction, setManualRateAction } from "@/lib/quotes/actions";
import type { ReviewQueueItem } from "@/lib/quotes/repository";

// The analyst-facing queue rows (issue #11). A client component because each row
// drives server actions (approve / reject / return-for-justification) and reflects
// the result inline. The Approve button mirrors the SERVER gate (ADR-0013/0014):
// disabled while conversion is pending or while a flagged quote lacks a
// justification — but the repository re-checks regardless, so the disable is only
// a courtesy, not the enforcement.

const cell = { border: "1px solid #ddd", padding: "0.4rem 0.6rem", textAlign: "left", verticalAlign: "top" } as const;
const btn = { padding: "0.35rem 0.7rem", marginRight: "0.4rem" } as const;

export function ReviewQueue({ items }: { items: ReviewQueueItem[] }) {
  if (items.length === 0) return null;
  return (
    <table style={{ borderCollapse: "collapse", width: "100%", marginTop: "1rem" }}>
      <thead>
        <tr>
          <th style={cell}>Study / Item</th>
          <th style={cell}>Quote</th>
          <th style={cell}>Local</th>
          <th style={cell}>USD / unit</th>
          <th style={cell}>QC</th>
          <th style={cell}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ item }: { item: ReviewQueueItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [rate, setRate] = useState("");

  const pendingConversion = item.conversionStatus === "pending" || item.conversionStatus === null;
  const flagged = item.flag.comparable && item.flag.flagged;
  const hasJustification = item.justification !== null && item.justification.trim() !== "";
  const needsJustification = flagged && !hasJustification;
  const approveDisabled = pending || pendingConversion || needsJustification;

  function run(action: () => Promise<{ ok: boolean; reason?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setRejecting(false);
        setReason("");
        setRate("");
        router.refresh();
      } else {
        setMessage(reasonText(result.reason));
      }
    });
  }

  function returnForJustification() {
    // Reject carrying only the DIRECTION, never the Client Price (ADR-0003).
    const dir = item.flag.comparable ? item.flag.direction : "unexpected";
    const word = dir === "above" ? "higher" : dir === "below" ? "lower" : "different";
    run(() =>
      rejectQuoteAction(item.id, `Price is ${word} than expected — please confirm and justify.`),
    );
  }

  return (
    <tr>
      <td style={cell}>
        <strong>{item.studyName}</strong> — {item.clientName}
        <br />
        {item.country} · {item.clientPartNumber}
        <br />
        <span style={{ color: "#777" }}>{item.itemDescription}</span>
      </td>
      <td style={cell}>
        #{item.quoteNumber} · {item.competitorBrand ?? "—"}
        <br />
        {item.dealerName ?? "—"}, {item.dealerLocation ?? "—"}
        <br />
        <span style={{ color: "#777" }}>by {item.authorName}</span>
      </td>
      <td style={cell}>
        {item.price ?? "—"} {item.currency ?? ""}
        <br />
        <span style={{ color: "#777" }}>×{item.quantityQuoted ?? "—"}</span>
      </td>
      <td style={cell}>
        {pendingConversion ? (
          <div>
            <em style={{ color: "#b80" }}>awaiting conversion</em>
            <div style={{ marginTop: "0.4rem" }}>
              <label style={{ color: "#777", fontSize: "0.85em" }}>
                USD per 1 {item.currency ?? "unit"}
              </label>
              <br />
              <input
                type="number"
                min="0"
                step="any"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="rate"
                style={{ width: "6rem" }}
              />
              <button
                type="button"
                style={btn}
                disabled={pending}
                onClick={() => run(() => setManualRateAction(item.id, rate))}
              >
                Save rate
              </button>
            </div>
          </div>
        ) : (
          <>
            ${item.convertedUsdPricePerUnit ?? "—"}
            <br />
            <span style={{ color: "#777" }}>total ${item.convertedUsdPrice ?? "—"}</span>
            {item.conversionStatus === "manual" && (
              <>
                <br />
                <span style={{ color: "#777", fontSize: "0.85em" }}>manual</span>
              </>
            )}
          </>
        )}
      </td>
      <td style={cell}>
        {!item.flag.comparable ? (
          <span style={{ color: "#777" }}>—</span>
        ) : item.flag.flagged ? (
          <span style={{ color: "#b00" }} title={`Client Price $${item.clientPrice}, threshold ${item.qcThresholdPct}%`}>
            ⚠ {item.flag.direction === "above" ? "higher" : item.flag.direction === "below" ? "lower" : "off"} (
            {item.flag.percentDiff.toFixed(1)}%)
          </span>
        ) : (
          <span style={{ color: "#0a0" }}>in range</span>
        )}
        {hasJustification && (
          <div style={{ marginTop: "0.3rem", color: "#555" }}>
            <em>“{item.justification}”</em>
          </div>
        )}
      </td>
      <td style={cell}>
        <button
          type="button"
          style={btn}
          disabled={approveDisabled}
          title={
            pendingConversion
              ? "Blocked: conversion still pending"
              : needsJustification
                ? "Blocked: flagged price needs the author's justification"
                : "Approve"
          }
          onClick={() => run(() => approveQuoteAction(item.id))}
        >
          Approve
        </button>

        {needsJustification && (
          <button type="button" style={btn} disabled={pending} onClick={returnForJustification}>
            Return for justification
          </button>
        )}

        {rejecting ? (
          <div style={{ marginTop: "0.4rem" }}>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required)"
              rows={2}
              style={{ width: "100%", boxSizing: "border-box" }}
            />
            <button
              type="button"
              style={btn}
              disabled={pending}
              onClick={() => run(() => rejectQuoteAction(item.id, reason))}
            >
              Confirm reject
            </button>
            <button type="button" style={btn} disabled={pending} onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" style={btn} disabled={pending} onClick={() => setRejecting(true)}>
            Reject…
          </button>
        )}

        {message !== null && (
          <p role="alert" style={{ color: "#b00", marginTop: "0.4rem" }}>
            {message}
          </p>
        )}
      </td>
    </tr>
  );
}

/** Turn a transition/access failure reason into an analyst-facing message. */
function reasonText(reason?: string): string {
  switch (reason) {
    case "conversion-pending":
      return "Can't approve yet — currency conversion is still pending.";
    case "needs-justification":
      return "This flagged price needs the author's justification before approval.";
    case "missing-reason":
      return "A reason is required to reject.";
    case "invalid-rate":
      return "Enter a valid exchange rate (a positive number).";
    case "not-pending":
      return "This quote is no longer awaiting conversion.";
    case "illegal-transition":
      return "This quote is no longer awaiting review (already actioned).";
    case "access":
      return "You're not permitted to review quotes.";
    default:
      return "Couldn't complete that action.";
  }
}
