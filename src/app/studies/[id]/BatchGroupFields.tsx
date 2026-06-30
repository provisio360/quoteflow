"use client";

import type { ReactNode } from "react";
import { stockStatusOptions } from "@/domains/quotes/stock-status";
import { leadTimeUnitOptions } from "@/domains/quotes/lead-time-unit";
import {
  brandGroup,
  stockStatusGroup,
  leadTimeGroup,
  warrantyGroup,
  landedCostGroup,
  discountGroup,
  type BatchGroupValues,
} from "@/domains/quotes/batch-line-fill";
import type { QuoteLineFields } from "@/lib/quotes/repository";
import { ValueUnitField } from "./ValueUnitField";
import { WarrantyField } from "./WarrantyField";
import { LandedCostField } from "./LandedCostField";
import { DiscountField } from "./DiscountField";

// The six Batch Line-Fill group inputs as ONE dumb, controlled component, shared by
// both batch surfaces so they can never present different field shapes (ADR-0036/0038):
//   - the Drafts panel (BatchFillPanel), which stamps EXISTING Draft lines, and
//   - the Collect dealer step (CollectPanel), which stamps each line AT creation.
// State is lifted to the parent (`values` / `onChange`) so each surface can read the
// merged stamp (via `batchStampFields`) or apply per-group. The Landed Cost block is
// rendered only when the document is cross-border (`showLandedCost`) — mirroring the
// single-line entry form, doc-uniform since both countries live on the document
// (ADR-0035). The optional `renderApply` slot lets the Drafts surface place a
// per-group "apply" button beside each block (the click is the intent); Collect omits
// it and stamps all groups together at seed.

export function BatchGroupFields({
  values,
  onChange,
  showLandedCost,
  renderApply,
}: {
  values: BatchGroupValues;
  onChange: (next: BatchGroupValues) => void;
  showLandedCost: boolean;
  renderApply?: (group: QuoteLineFields) => ReactNode;
}) {
  const set = <K extends keyof BatchGroupValues>(key: K, value: string) =>
    onChange({ ...values, [key]: value });

  const apply = (group: QuoteLineFields) => (renderApply ? renderApply(group) : null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <label>
          Competitor brand{" "}
          <input
            type="text"
            value={values.competitorBrand}
            onChange={(e) => set("competitorBrand", e.target.value)}
            style={{ padding: "0.2rem" }}
          />
        </label>
        {apply(brandGroup(values.competitorBrand))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <label>
          Stock status{" "}
          <select
            value={values.stockStatus}
            onChange={(e) => set("stockStatus", e.target.value)}
            style={{ padding: "0.2rem" }}
          >
            <option value="">— select —</option>
            {stockStatusOptions(values.stockStatus || undefined).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {apply(stockStatusGroup(values.stockStatus))}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: "0.4rem" }}>
        <div style={{ flex: 1 }}>
          <ValueUnitField
            mode="controlled"
            label="Shipping lead time"
            unitOptions={leadTimeUnitOptions}
            value={values.leadTimeValue}
            unit={values.leadTimeUnit}
            onValueChange={(v) => set("leadTimeValue", v)}
            onUnitChange={(v) => set("leadTimeUnit", v)}
          />
        </div>
        {apply(leadTimeGroup(values.leadTimeValue, values.leadTimeUnit))}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: "0.4rem" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <WarrantyField
            mode="controlled"
            offered={values.warrantyOffered}
            onOfferedChange={(v) => set("warrantyOffered", v)}
            values={{
              warranty1Value: values.warranty1Value,
              warranty1Unit: values.warranty1Unit,
              warranty2Value: values.warranty2Value,
              warranty2Unit: values.warranty2Unit,
            }}
            onChange={(field, next) => set(field, next)}
          />
        </div>
        {apply(
          warrantyGroup(
            values.warrantyOffered,
            values.warranty1Value,
            values.warranty1Unit,
            values.warranty2Value,
            values.warranty2Unit,
          ),
        )}
      </div>

      {showLandedCost && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "0.4rem" }}>
          <div style={{ flex: 1 }}>
            <LandedCostField
              mode="controlled"
              included={values.landedCostIncluded}
              onIncludedChange={(v) => set("landedCostIncluded", v)}
              note={values.landedCostNote}
              onNoteChange={(v) => set("landedCostNote", v)}
            />
          </div>
          {apply(landedCostGroup(values.landedCostIncluded, values.landedCostNote))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-end", gap: "0.4rem" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <DiscountField
            mode="controlled"
            available={values.discountAvailable}
            onAvailableChange={(v) => set("discountAvailable", v)}
            applied={values.discountApplied}
            onAppliedChange={(v) => set("discountApplied", v)}
            type={values.discountType}
            onTypeChange={(v) => set("discountType", v)}
            value={values.discountValue}
            onValueChange={(v) => set("discountValue", v)}
          />
        </div>
        {apply(
          discountGroup(
            values.discountAvailable,
            values.discountType,
            values.discountApplied,
            values.discountValue,
          ),
        )}
      </div>
    </div>
  );
}
