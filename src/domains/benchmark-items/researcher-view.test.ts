import { describe, expect, it } from "vitest";
import {
  addLineCandidates,
  partitionSubmitReport,
  quoteGroups,
  researcherCountryGroups,
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

describe("researcherCountryGroups", () => {
  it("groups assigned-Country items by Country, carrying the guidance fields (no work mode — ADR-0038 retires the tri-mode)", () => {
    const groups = researcherCountryGroups(
      [
        item({ id: "de-1", country: "Germany" }),
        item({ id: "de-2", country: "Germany" }),
        item({ id: "fr-1", country: "France" }),
      ],
      new Set(["Germany", "France"]),
    );

    const byCountry = new Map(groups.map((g) => [g.country, g.items]));
    expect(byCountry.get("Germany")?.map((i) => i.id)).toEqual(["de-1", "de-2"]);
    expect(byCountry.get("France")?.map((i) => i.id)).toEqual(["fr-1"]);
    // Guidance the Collect lens needs is threaded through (no Client Price, ADR-0003).
    expect(byCountry.get("Germany")?.[0].requiredQuotes).toBe(3);
    expect(byCountry.get("Germany")?.[0].clientItemNumber).toBe("CPN-001");
  });

  it("drops an item in a Country I am not assigned to — backstop, never grouped (ADR-0025)", () => {
    const groups = researcherCountryGroups(
      [
        item({ id: "mine", country: "Germany" }),
        item({ id: "stray", country: "France" }),
      ],
      new Set(["Germany"]),
    );

    expect(groups.map((g) => g.country)).toEqual(["Germany"]);
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(["mine"]);
  });

  it("orders a Country's parts by Client Source Unit (A→Z, nulls last) then Client Item Number (ADR-0040)", () => {
    const groups = researcherCountryGroups(
      [
        item({ id: "a", country: "Germany", clientSourceUnit: "Model Z", clientItemNumber: "100" }),
        item({ id: "b", country: "Germany", clientSourceUnit: "Model A", clientItemNumber: "200" }),
        item({ id: "c", country: "Germany", clientSourceUnit: "Model A", clientItemNumber: "100" }),
        item({ id: "d", country: "Germany", clientSourceUnit: null, clientItemNumber: "001" }),
      ],
      new Set(["Germany"]),
    );

    expect(groups[0].items.map((i) => i.id)).toEqual(["c", "b", "a", "d"]);
  });
});

describe("quoteGroups", () => {
  // A Quote Group is a non-persisted ordinal lens (ADR-0038): within a Country there
  // are max(Required Quotes) groups, and a part appears in slots 1 … its own Required
  // Quotes. Caller scopes `items` to one Country first.
  it("renders max(Required Quotes) groups; group N lists parts with Required Quotes >= N", () => {
    const groups = quoteGroups([
      item({ id: "a", requiredQuotes: 1 }),
      item({ id: "b", requiredQuotes: 3 }),
    ]);

    expect(groups.map((g) => g.groupNumber)).toEqual([1, 2, 3]);
    expect(groups[0].members.map((m) => m.id)).toEqual(["a", "b"]); // group 1: both
    expect(groups[1].members.map((m) => m.id)).toEqual(["b"]); // group 2: only b (>=2)
    expect(groups[2].members.map((m) => m.id)).toEqual(["b"]); // group 3: only b (>=3)
  });

  it("collapsed escape hatch lists the Country's off-slot parts (Required Quotes < N)", () => {
    // A dealer carrying an off-slot part is never imprisoned by the slot (ADR-0038):
    // group N's otherParts is everything below the slot.
    const groups = quoteGroups([
      item({ id: "a", requiredQuotes: 1 }),
      item({ id: "b", requiredQuotes: 3 }),
    ]);

    expect(groups[0].otherParts).toEqual([]); // group 1: nothing is below slot 1
    expect(groups[1].otherParts.map((m) => m.id)).toEqual(["a"]); // a (1) < 2
    expect(groups[2].otherParts.map((m) => m.id)).toEqual(["a"]); // a (1) < 3
  });

  it("a Country with no parts above Required Quotes 0 yields no groups", () => {
    expect(quoteGroups([])).toEqual([]);
    expect(quoteGroups([item({ requiredQuotes: 0 })])).toEqual([]);
  });

  // #142: each part carries a layered progress count — approved n/N (all-author,
  // the Release-Eligibility figure) plus the viewing researcher's own in-flight
  // tally — and a pre-check default keyed on the approved figure ALONE.
  it("attaches approved + my-in-flight counts and pre-checks members still short on approved", () => {
    const groups = quoteGroups(
      [item({ id: "a", requiredQuotes: 6 })],
      new Map([["a", { approvedCount: 2, myInFlightCount: 3 }]]),
    );

    const [partA] = groups[0].members;
    expect(partA.approvedCount).toBe(2);
    expect(partA.myInFlightCount).toBe(3);
    expect(partA.requiredQuotes).toBe(6);
    expect(partA.preChecked).toBe(true); // 2 approved < 6 required
  });

  it("a member satisfied on approved is not pre-checked but stays selectable in members", () => {
    const groups = quoteGroups(
      [item({ id: "a", requiredQuotes: 2 })],
      new Map([["a", { approvedCount: 2, myInFlightCount: 0 }]]),
    );
    const [partA] = groups[0].members;
    expect(partA.preChecked).toBe(false); // 2 approved >= 2 required → satisfied
    expect(groups[0].members.map((m) => m.id)).toEqual(["a"]); // not relegated
  });

  it("in-flight never suppresses the pre-check: a short-on-approved part stays checked", () => {
    const groups = quoteGroups(
      [item({ id: "a", requiredQuotes: 3 })],
      new Map([["a", { approvedCount: 1, myInFlightCount: 5 }]]),
    );
    expect(groups[0].members[0].preChecked).toBe(true); // 1 < 3 despite 5 in flight
  });

  it("an off-slot escape-hatch part is never pre-checked even when short on approved", () => {
    // a needs 1 (short on approved), so in group 2 it is otherParts — never nudged.
    const groups = quoteGroups(
      [item({ id: "a", requiredQuotes: 1 }), item({ id: "b", requiredQuotes: 2 })],
      new Map([["a", { approvedCount: 0, myInFlightCount: 0 }]]),
    );
    expect(groups[1].otherParts.map((m) => m.id)).toEqual(["a"]);
    expect(groups[1].otherParts[0].preChecked).toBe(false);
  });

  it("a part with no quotes defaults to zero counts (absent from the map)", () => {
    const groups = quoteGroups([item({ id: "a", requiredQuotes: 1 })]);
    const [partA] = groups[0].members;
    expect(partA.approvedCount).toBe(0);
    expect(partA.myInFlightCount).toBe(0);
    expect(partA.preChecked).toBe(true); // 0 < 1
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
  // Pre-claiming is gone (ADR-0038): the candidate set is no longer primary-only.
  // Any part in the document's Country the doc does not already cover is offerable;
  // filing the line auto-claims an unclaimed part. So the filter is Country +
  // not-already-on-this-document, nothing about who leads it.
  it("offers items in the doc's country that the doc does not already cover, whoever leads them", () => {
    const items = [
      item({ id: "pump", clientItemNumber: "CPN-001", itemDescription: "pump", primaryResearcherId: "user-me", country: "Germany" }),
      item({ id: "valve", clientItemNumber: "CPN-002", itemDescription: "valve", primaryResearcherId: "user-other", country: "Germany" }),
      item({ id: "gasket", clientItemNumber: "CPN-003", itemDescription: "gasket", primaryResearcherId: null, country: "Germany" }),
    ];
    // The doc already has a line for the pump → the peer-led valve and the
    // unclaimed gasket both remain offerable.
    const candidates = addLineCandidates(items, "Germany", new Set(["pump"]));

    expect(candidates).toEqual([
      { id: "valve", label: "CPN-002 valve" },
      { id: "gasket", label: "CPN-003 gasket" },
    ]);
  });

  it("excludes items in another country", () => {
    const items = [
      item({ id: "here", primaryResearcherId: null, country: "Germany" }),
      item({ id: "elsewhere", primaryResearcherId: "user-me", country: "France" }),
    ];
    const candidates = addLineCandidates(items, "Germany", new Set());

    expect(candidates.map((c) => c.id)).toEqual(["here"]);
  });
});
