import { describe, it, expect } from "vitest";
import { studyRatePreview } from "./preview";
import type { StudyRateRow } from "./lookup";

const row = (rateDate: string, rate: string): StudyRateRow => ({
  rateDate: new Date(`${rateDate}T00:00:00.000Z`),
  rate,
});
const on = (date: string) => new Date(`${date}T00:00:00.000Z`);

describe("studyRatePreview — the entry-time view-model over the shared lookup (#162, ADR-0041)", () => {
  it("hits the nearest prior row and reports its rate, date, and whole-day age", () => {
    const rows = [row("2026-01-01", "5.0"), row("2026-03-14", "4.9321")];
    expect(studyRatePreview("EUR", on("2026-04-01"), rows, on("2026-04-30"))).toEqual({
      kind: "hit",
      rate: "4.9321",
      rateDate: on("2026-03-14"),
      ageDays: 47,
    });
  });

  it("misses when the currency has no covering row — warn, show no number", () => {
    expect(studyRatePreview("EUR", on("2026-04-01"), [], on("2026-04-30"))).toEqual({ kind: "miss" });
  });

  it("misses when the quote predates the earliest row — never reaches forward", () => {
    const rows = [row("2026-03-14", "4.9321")];
    expect(studyRatePreview("EUR", on("2026-01-01"), rows, on("2026-04-30"))).toEqual({ kind: "miss" });
  });

  it("treats a USD document as its own case — live per-unit, no warning, no row", () => {
    expect(studyRatePreview("usd", on("2026-04-01"), [], on("2026-04-30"))).toEqual({ kind: "usd" });
  });

  it("still hits a stale row and surfaces its large age — age never blocks", () => {
    const rows = [row("2024-01-01", "5.0")];
    expect(studyRatePreview("EUR", on("2026-06-30"), rows, on("2026-06-30"))).toEqual({
      kind: "hit",
      rate: "5.0",
      rateDate: on("2024-01-01"),
      ageDays: 911,
    });
  });
});
