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
    clientPartNumber: "CPN-001",
    itemDescription: "Hydraulic pump",
    configurationComment: "230V variant",
    quantity: 10,
    machineModel: "Model X",
    requiredQuotes: 3,
    primaryResearcherId: null,
    ...overrides,
  };
}

describe("resolveResearcherEntries", () => {
  it("own claim resolves to mine and carries all guidance fields", () => {
    const me = "user-me";
    const entries = resolveResearcherEntries(
      [item({ primaryResearcherId: me })],
      new Set<string>(),
      me,
    );

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.mode).toBe("mine");
    // The defect (#66): these guidance fields were dropped before the UI.
    expect(entry.item.configurationComment).toBe("230V variant");
    expect(entry.item.quantity).toBe(10);
    expect(entry.item.machineModel).toBe("Model X");
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

  it("unclaimed item outside my Country pool resolves to locked", () => {
    const entries = resolveResearcherEntries(
      [item({ primaryResearcherId: null, country: "France" })],
      new Set(["Germany"]),
      "user-me",
    );
    expect(entries[0].mode).toBe("locked");
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
