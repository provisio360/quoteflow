"use client";

import { formatMoneyInput, parseMoneyInput } from "@/domains/quotes/format-money";

// The shared value+unit pair widget (#129 / ADR-0036): one grouped-money value
// input plus one unit <select>, used identically by the single-line QuoteEditor and
// the Batch Line-Fill panel so the two surfaces can never present a divergent field
// shape (AC4). The value groups at rest unit-agnostically like a warranty value
// (ADR-0034): a `text` input — a number input can't hold a comma — that strips the
// thousands commas on focus and re-groups on blur.
//
// Dual-mode by design (grilling Q2): the editor renders it UNCONTROLLED (a FormData
// `name` + defaultValue, read on submit), the panel CONTROLLED (value/onChange, read
// on the per-group apply click). Same markup and same `unitOptions` either way.

type UnitOption = { value: string; label: string };

type Common = {
  /** Base label, e.g. "Warranty 1" or "Shipping lead time". */
  label: string;
  /** The unit option source (warrantyUnitOptions / leadTimeUnitOptions). */
  unitOptions: (current?: string) => readonly UnitOption[];
};

type Uncontrolled = Common & {
  mode: "uncontrolled";
  valueName: string;
  unitName: string;
  defaultValue?: number | string | null;
  defaultUnit?: string | null;
};

type Controlled = Common & {
  mode: "controlled";
  value: string;
  unit: string;
  onValueChange: (next: string) => void;
  onUnitChange: (next: string) => void;
};

const input = { padding: "0.3rem 0.4rem", width: "100%", boxSizing: "border-box" } as const;
const valueStyle = { ...input, textAlign: "right" } as const;
const labelStyle = { fontSize: "0.85rem" } as const;

function regroup(raw: string): string {
  const v = parseMoneyInput(raw.trim());
  if (v === "" || Number.isNaN(Number(v))) return v;
  return formatMoneyInput(v, "");
}

export function ValueUnitField(props: Uncontrolled | Controlled) {
  const { label, unitOptions } = props;
  const currentUnit = props.mode === "controlled" ? props.unit : props.defaultUnit ?? undefined;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
      <label style={labelStyle}>
        {label} value
        {props.mode === "uncontrolled" ? (
          <input
            name={props.valueName}
            type="text"
            inputMode="decimal"
            defaultValue={formatMoneyInput(props.defaultValue, "")}
            onFocus={(e) => {
              e.target.value = parseMoneyInput(e.target.value);
            }}
            onBlur={(e) => {
              e.target.value = regroup(e.target.value);
            }}
            style={valueStyle}
          />
        ) : (
          <input
            type="text"
            inputMode="decimal"
            value={props.value}
            onChange={(e) => props.onValueChange(e.target.value)}
            onFocus={(e) => props.onValueChange(parseMoneyInput(e.target.value))}
            onBlur={(e) => props.onValueChange(regroup(e.target.value))}
            style={valueStyle}
          />
        )}
      </label>
      <label style={labelStyle}>
        {label} unit
        {props.mode === "uncontrolled" ? (
          <select name={props.unitName} defaultValue={props.defaultUnit ?? ""} style={input}>
            <option value="">— select —</option>
            {unitOptions(currentUnit).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <select value={props.unit} onChange={(e) => props.onUnitChange(e.target.value)} style={input}>
            <option value="">— select —</option>
            {unitOptions(currentUnit).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </label>
    </div>
  );
}
