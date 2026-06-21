import { describe, expect, it } from "vitest";
import { quoteAffordances, resolveResearcherEntries } from "./researcher-view";
import type { ResearcherItemView } from "@/lib/benchmark-items/repository";

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

describe("quoteAffordances", () => {
  // A peer's quote on the same item is readable once it leaves Draft (ADR-0011),
  // but it is not mine to act on: no write affordance and no rejection reason
  // (#68 — closes the latent leak where these keyed off state, not authorship).
  it("a quote I do not own exposes no affordances, whatever its state", () => {
    for (const state of ["Draft", "Submitted", "Approved", "Rejected"] as const) {
      const a = quoteAffordances({ state, createdById: "user-other" }, "user-me");
      expect(a).toEqual({
        canEdit: false,
        canSubmit: false,
        canDelete: false,
        canRevise: false,
        showRejectionReason: false,
      });
    }
  });

  it("my own Draft can be edited, submitted, and deleted", () => {
    const a = quoteAffordances({ state: "Draft", createdById: "user-me" }, "user-me");
    expect(a).toEqual({
      canEdit: true,
      canSubmit: true,
      canDelete: true,
      canRevise: false,
      showRejectionReason: false,
    });
  });

  it("my own Rejected quote can be revised and shows its rejection reason", () => {
    const a = quoteAffordances({ state: "Rejected", createdById: "user-me" }, "user-me");
    expect(a).toEqual({
      canEdit: false,
      canSubmit: false,
      canDelete: false,
      canRevise: true,
      showRejectionReason: true,
    });
  });
});
