import { describe, expect, it } from "vitest";
import {
  addLineCandidates,
  partitionSubmitReport,
  quoteAffordances,
  resolveResearcherEntries,
} from "./researcher-view";
import type { ResearcherItemView } from "@/lib/benchmark-items/repository";
import type { IncompleteLine } from "@/domains/quotes/lifecycle";

// A Benchmark Item as the researcher read-path returns it (RESEARCHER_VIEW_SELECT).
// Overrides let each test set only the fields it cares about.
function item(overrides: Partial<ResearcherItemView> = {}): ResearcherItemView {
  return {
    id: "item-1",
    studyId: "study-1",
    country: "Germany",
    clientItemNumber: "CPN-001",
    itemDescription: "Hydraulic pump",
    configurationComment: "230V variant",
    quantity: 10,
    clientSourceUnit: "Model X",
    requiredQuotes: 3,
    primaryResearcherId: null,
    ...overrides,
  };
}

describe("resolveResearcherEntries", () => {
  it("own claim resolves to mine and carries all guidance fields", () => {
    const me = "user-me";
    // Being Primary requires a Country Assignment (self-assign enforces it), so a
    // 'mine' item is always in an assigned Country.
    const entries = resolveResearcherEntries(
      [item({ primaryResearcherId: me, country: "Germany" })],
      new Set(["Germany"]),
      me,
    );

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.mode).toBe("mine");
    // The defect (#66): these guidance fields were dropped before the UI.
    expect(entry.item.configurationComment).toBe("230V variant");
    expect(entry.item.quantity).toBe(10);
    expect(entry.item.clientSourceUnit).toBe("Model X");
  });

  it("another researcher's claim resolves to claimed", () => {
    const entries = resolveResearcherEntries(
      [item({ primaryResearcherId: "user-other" })],
      new Set(["Germany"]),
      "user-me",
    );
    expect(entries[0].mode).toBe("claimed");
  });

  it("unclaimed item in my Country pool resolves to claimable", () => {
    const entries = resolveResearcherEntries(
      [item({ primaryResearcherId: null, country: "Germany" })],
      new Set(["Germany"]),
      "user-me",
    );
    expect(entries[0].mode).toBe("claimable");
  });

  it("an item outside my assigned Countries is DROPPED, never returned (no `locked` mode — ADR-0025)", () => {
    // The query is the primary wall (unassigned items are not loaded); this is the
    // app-layer backstop — a stray unassigned item is filtered out, not rendered
    // as a 'locked' row that would leak its country/description across the boundary.
    const entries = resolveResearcherEntries(
      [
        item({ id: "mine", primaryResearcherId: null, country: "Germany" }),
        item({ id: "stray", primaryResearcherId: null, country: "France" }),
      ],
      new Set(["Germany"]),
      "user-me",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].item.id).toBe("mine");
    expect(entries.some((e) => e.item.country === "France")).toBe(false);
  });
});

describe("partitionSubmitReport", () => {
  // The Draft lines of the document group, with the labels the panel renders.
  const draftLines = [
    { lineId: "l-12", quoteLineNumber: 12, itemLabel: "CPN-001 pump" },
    { lineId: "l-15", quoteLineNumber: 15, itemLabel: "CPN-002 valve" },
  ];

  it("surfaces a doc-level missing field once, not repeated per line", () => {
    // submitDocument prepends the shared doc-missing to EVERY incomplete line.
    const perLine: IncompleteLine[] = [
      { lineId: "l-12", missing: ["currency", "price"] },
      { lineId: "l-15", missing: ["currency", "price", "quantityQuoted"] },
    ];
    const report = partitionSubmitReport(perLine, draftLines);

    // currency belongs to the document → shown once, not on any line.
    expect(report.docMissing).toEqual(["currency"]);
    expect(report.lines.flatMap((l) => l.missing)).not.toContain("currency");
  });

  it("keeps line-level missing per line, keyed by Quote Line number and item label", () => {
    const perLine: IncompleteLine[] = [
      { lineId: "l-12", missing: ["price"] },
      { lineId: "l-15", missing: ["price", "quantityQuoted"] },
    ];
    const report = partitionSubmitReport(perLine, draftLines);

    expect(report.docMissing).toEqual([]);
    expect(report.lines).toEqual([
      { lineId: "l-12", quoteLineNumber: 12, itemLabel: "CPN-001 pump", missing: ["price"] },
      {
        lineId: "l-15",
        quoteLineNumber: 15,
        itemLabel: "CPN-002 valve",
        missing: ["price", "quantityQuoted"],
      },
    ]);
  });

  it("a line missing only doc fields is covered by the banner, not listed per line", () => {
    const perLine: IncompleteLine[] = [
      { lineId: "l-12", missing: ["currency"] },
      { lineId: "l-15", missing: ["currency", "price"] },
    ];
    const report = partitionSubmitReport(perLine, draftLines);

    expect(report.docMissing).toEqual(["currency"]);
    // l-12 has no line-level shortfall → omitted; only l-15 remains.
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0].lineId).toBe("l-15");
    expect(report.lines[0].missing).toEqual(["price"]);
  });
});

describe("addLineCandidates", () => {
  const me = "user-me";

  it("offers my-led items in the doc's country that the doc does not already cover", () => {
    const items = [
      item({ id: "pump", clientItemNumber: "CPN-001", itemDescription: "pump", primaryResearcherId: me, country: "Germany" }),
      item({ id: "valve", clientItemNumber: "CPN-002", itemDescription: "valve", primaryResearcherId: me, country: "Germany" }),
    ];
    // The doc already has a line for the pump → only the valve remains.
    const candidates = addLineCandidates(items, "Germany", new Set(["pump"]), me);

    expect(candidates).toEqual([{ id: "valve", label: "CPN-002 valve" }]);
  });

  it("excludes items I do not lead and items in another country", () => {
    const items = [
      item({ id: "mine", primaryResearcherId: me, country: "Germany" }),
      item({ id: "peer", primaryResearcherId: "user-other", country: "Germany" }),
      item({ id: "elsewhere", primaryResearcherId: me, country: "France" }),
    ];
    const candidates = addLineCandidates(items, "Germany", new Set(), me);

    expect(candidates.map((c) => c.id)).toEqual(["mine"]);
  });
});

describe("quoteAffordances", () => {
  // The item view is now a read-only reference: all Draft mutation (edit/delete)
  // and submit moved to the document panel (#97/Q8). The item view keeps only the
  // Rejected-line affordances — Revise and the rejection reason.
  it("a quote I do not own exposes no affordances, whatever its state", () => {
    for (const state of ["Draft", "Submitted", "Approved", "Rejected"] as const) {
      const a = quoteAffordances({ state, createdById: "user-other" }, "user-me");
      expect(a).toEqual({ canRevise: false, showRejectionReason: false });
    }
  });

  it("my own Draft exposes no item-view affordances (Draft mgmt lives in the doc panel)", () => {
    const a = quoteAffordances({ state: "Draft", createdById: "user-me" }, "user-me");
    expect(a).toEqual({ canRevise: false, showRejectionReason: false });
  });

  it("my own Rejected quote can be revised and shows its rejection reason", () => {
    const a = quoteAffordances({ state: "Rejected", createdById: "user-me" }, "user-me");
    expect(a).toEqual({ canRevise: true, showRejectionReason: true });
  });
});
