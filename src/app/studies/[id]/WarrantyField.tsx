"use client";

import { warrantyUnitOptions } from "@/domains/quotes/warranty-unit";
import { ValueUnitField } from "./ValueUnitField";

// The shared Warranty chain widget (ADR-0037): a tri-state "Warranty offered?" select
// gating up to two value+unit pairs. The pairs render ONLY under "Yes", so a No/blank
// answer never shows (or, in the editor, posts) a stale pair; the form parser and the
// batch `warrantyGroup` both additionally NULL the pairs when not Yes so the DB never
// carries a "No" line with a residual warranty. Used identically by the single-line
// QuoteEditor and the Batch Line-Fill panel so the two surfaces can never present a
// divergent field shape. Mirrors DiscountField's gate-over-children shape.
//
// Dual-mode (mirrors DiscountField/ValueUnitField): the Offered select is controlled in
// BOTH surfaces (it drives the pairs' visibility), but the two pairs are UNCONTROLLED in
// the editor (FormData `name` + defaultValue, read on submit) and CONTROLLED in the panel
// (value/onChange, read on the per-group apply click).

type Common = {
  /** "Offered?" tri-state: "" (unanswered) / "true" / "false". */
  offered: string;
  onOfferedChange: (next: string) => void;
};

type Uncontrolled = Common & {
  mode: "uncontrolled";
  offeredName: string;
  defaults?: Partial<Record<string, string>>;
};

type Controlled = Common & {
  mode: "controlled";
  values: {
    warranty1Value: string;
    warranty1Unit: string;
    warranty2Value: string;
    warranty2Unit: string;
  };
  onChange: (field: keyof Controlled["values"], next: string) => void;
};

const input = { padding: "0.3rem 0.4rem", width: "100%", boxSizing: "border-box" } as const;
const labelStyle = { fontSize: "0.85rem" } as const;

export function WarrantyField(props: Uncontrolled | Controlled) {
  const { offered, onOfferedChange } = props;
  return (
    <>
      <label style={labelStyle}>
        Warranty offered?
        <select
          name={props.mode === "uncontrolled" ? props.offeredName : undefined}
          value={offered}
          onChange={(e) => onOfferedChange(e.target.value)}
          style={input}
        >
          <option value="">— select —</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      {offered === "true" &&
        ([1, 2] as const).map((n) =>
          props.mode === "uncontrolled" ? (
            <ValueUnitField
              key={n}
              mode="uncontrolled"
              label={`Warranty ${n}`}
              unitOptions={warrantyUnitOptions}
              valueName={`warranty${n}Value`}
              unitName={`warranty${n}Unit`}
              defaultValue={props.defaults?.[`warranty${n}Value`]}
              defaultUnit={props.defaults?.[`warranty${n}Unit`]}
            />
          ) : (
            <ValueUnitField
              key={n}
              mode="controlled"
              label={`Warranty ${n}`}
              unitOptions={warrantyUnitOptions}
              value={props.values[`warranty${n}Value` as keyof Controlled["values"]]}
              unit={props.values[`warranty${n}Unit` as keyof Controlled["values"]]}
              onValueChange={(v) => props.onChange(`warranty${n}Value` as keyof Controlled["values"], v)}
              onUnitChange={(v) => props.onChange(`warranty${n}Unit` as keyof Controlled["values"], v)}
            />
          ),
        )}
    </>
  );
}
