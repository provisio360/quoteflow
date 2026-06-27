"use client";

// The shared Discount chain widget (#131 / ADR-0036): a tri-state "Available?"
// select gating a free-text Type + a tri-state "Applied?" select, which in turn
// gates the % value. The nested fields render ONLY under their "Yes" parent, so a
// No/blank answer never shows (or, in the editor, posts) a stale child. Type rides
// under Available (captured even when not applied, CONTEXT); % rides under Applied.
// Used identically by the single-line QuoteEditor and the Batch Line-Fill panel so
// the two surfaces can never present a divergent field shape; chain coherence is
// also enforced in the batch builder (`discountGroup`). The % is recorded as typed
// (15 = 15%) and is NEVER applied to the price (CONTEXT/ADR-0026).
//
// Dual-mode (mirrors LandedCostField): both selects are controlled in BOTH surfaces
// (each drives a child's visibility), but the Type/% inputs are UNCONTROLLED in the
// editor (a FormData `name` + defaultValue, read on submit) and CONTROLLED in the
// panel (value/onChange, read on the per-group apply click).

type Common = {
  /** "Available?" tri-state: "" (unanswered) / "true" / "false". */
  available: string;
  onAvailableChange: (next: string) => void;
  /** "Applied?" tri-state: "" / "true" / "false". */
  applied: string;
  onAppliedChange: (next: string) => void;
};

type Uncontrolled = Common & {
  mode: "uncontrolled";
  typeName: string;
  valueName: string;
  availableName: string;
  appliedName: string;
  defaultType?: string | null;
  defaultValue?: string | number | null;
};

type Controlled = Common & {
  mode: "controlled";
  type: string;
  onTypeChange: (next: string) => void;
  value: string;
  onValueChange: (next: string) => void;
};

const input = { padding: "0.3rem 0.4rem", width: "100%", boxSizing: "border-box" } as const;
const labelStyle = { fontSize: "0.85rem" } as const;

export function DiscountField(props: Uncontrolled | Controlled) {
  const { available, onAvailableChange, applied, onAppliedChange } = props;
  return (
    <>
      <label style={labelStyle}>
        Discount available?
        <select
          name={props.mode === "uncontrolled" ? props.availableName : undefined}
          value={available}
          onChange={(e) => onAvailableChange(e.target.value)}
          style={input}
        >
          <option value="">— select —</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      {available === "true" && (
        <>
          {/* Type describes the kind of discount on offer — captured whenever a
              discount is available, even if it was not applied to this quote. */}
          <label style={labelStyle}>
            Discount type
            {props.mode === "uncontrolled" ? (
              <input name={props.typeName} defaultValue={props.defaultType ?? ""} style={input} />
            ) : (
              <input value={props.type} onChange={(e) => props.onTypeChange(e.target.value)} style={input} />
            )}
          </label>
          <label style={labelStyle}>
            Discount applied to the quote?
            <select
              name={props.mode === "uncontrolled" ? props.appliedName : undefined}
              value={applied}
              onChange={(e) => onAppliedChange(e.target.value)}
              style={input}
            >
              <option value="">— select —</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
        </>
      )}
      {available === "true" && applied === "true" && (
        <label style={labelStyle}>
          Discount %
          {props.mode === "uncontrolled" ? (
            <input
              name={props.valueName}
              type="number"
              inputMode="decimal"
              defaultValue={props.defaultValue ?? ""}
              style={{ ...input, textAlign: "right" }}
            />
          ) : (
            <input
              type="number"
              inputMode="decimal"
              value={props.value}
              onChange={(e) => props.onValueChange(e.target.value)}
              style={{ ...input, textAlign: "right" }}
            />
          )}
        </label>
      )}
    </>
  );
}
