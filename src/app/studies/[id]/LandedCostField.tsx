"use client";

// The shared Landed Cost chain widget (#130 / ADR-0035): a tri-state Included?
// select gating a Note that renders ONLY under Yes, so a No/blank answer never shows
// (or, in the editor, posts) a stale note. Used identically by the single-line
// QuoteEditor and the Batch Line-Fill panel so the two surfaces can never present a
// divergent field shape; the chain coherence (Note kept only with Yes) is also
// enforced in the batch builder (`landedCostGroup`).
//
// Dual-mode (grilling): the Included? select is controlled in BOTH surfaces (its
// value drives the Note's visibility), but the Note is UNCONTROLLED in the editor (a
// FormData `name` + defaultValue, read on submit) and CONTROLLED in the panel
// (value/onChange, read on the per-group apply click).

type Common = {
  /** The Included? tri-state: "" (unanswered) / "true" / "false". */
  included: string;
  onIncludedChange: (next: string) => void;
};

type Uncontrolled = Common & {
  mode: "uncontrolled";
  includedName: string;
  noteName: string;
  defaultNote?: string | null;
};

type Controlled = Common & {
  mode: "controlled";
  note: string;
  onNoteChange: (next: string) => void;
};

const input = { padding: "0.3rem 0.4rem", width: "100%", boxSizing: "border-box" } as const;
const labelStyle = { fontSize: "0.85rem" } as const;

export function LandedCostField(props: Uncontrolled | Controlled) {
  const { included, onIncludedChange } = props;
  return (
    <>
      <label style={labelStyle}>
        Landed cost included in the price? *
        <select
          name={props.mode === "uncontrolled" ? props.includedName : undefined}
          value={included}
          onChange={(e) => onIncludedChange(e.target.value)}
          style={input}
        >
          <option value="">— select —</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      {included === "true" && (
        <label style={labelStyle}>
          Landed cost note
          {props.mode === "uncontrolled" ? (
            <input name={props.noteName} defaultValue={props.defaultNote ?? ""} style={input} />
          ) : (
            <input value={props.note} onChange={(e) => props.onNoteChange(e.target.value)} style={input} />
          )}
        </label>
      )}
    </>
  );
}
