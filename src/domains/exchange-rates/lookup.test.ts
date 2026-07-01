import { describe, it, expect } from "vitest";
import { decideStudyRatePin, type StudyRateRow } from "./lookup";

const row = (rateDate: string, rate: string): StudyRateRow => ({
  rateDate: new Date(`${rateDate}T00:00:00.000Z`),
  rate,
});

describe("decideStudyRatePin — the shared study-rate lookup (#161, ADR-0041)", () => {
  it("hits the row with the greatest rateDate on or before Date Quote Received", () => {
    const rows = [row("2026-01-01", "5.0"), row("2026-02-01", "6.0"), row("2026-03-01", "7.0")];
    const pin = decideStudyRatePin("EUR", new Date("2026-02-15T00:00:00.000Z"), rows);
    expect(pin).toEqual({ hit: true, rate: "6.0", rateDate: new Date("2026-02-01T00:00:00.000Z") });
  });

  it("misses when the currency has no rows at all", () => {
    expect(decideStudyRatePin("EUR", new Date("2026-02-15T00:00:00.000Z"), [])).toEqual({ hit: false });
  });

  it("misses when the quote predates the earliest row (never reaches forward)", () => {
    const rows = [row("2026-02-01", "6.0"), row("2026-03-01", "7.0")];
    expect(decideStudyRatePin("EUR", new Date("2026-01-15T00:00:00.000Z"), rows)).toEqual({ hit: false });
  });

  it("hits an exact rateDate match", () => {
    const rows = [row("2026-02-01", "6.0")];
    expect(decideStudyRatePin("EUR", new Date("2026-02-01T00:00:00.000Z"), rows)).toEqual({
      hit: true,
      rate: "6.0",
      rateDate: new Date("2026-02-01T00:00:00.000Z"),
    });
  });

  it("still hits a stale row — age never blocks, only the greatest ≤ date wins", () => {
    const rows = [row("2024-01-01", "5.0")];
    const pin = decideStudyRatePin("EUR", new Date("2026-06-30T00:00:00.000Z"), rows);
    expect(pin).toEqual({ hit: true, rate: "5.0", rateDate: new Date("2024-01-01T00:00:00.000Z") });
  });

  it("misses for USD in any case — it converts 1:1, never a table hit (Q6)", () => {
    const rows = [row("2026-01-01", "1.0")];
    expect(decideStudyRatePin("usd", new Date("2026-02-15T00:00:00.000Z"), rows)).toEqual({ hit: false });
  });
});
