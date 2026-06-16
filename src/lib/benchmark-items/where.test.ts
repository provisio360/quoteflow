import { describe, it, expect } from "vitest";
import { itemVisibilityWhere } from "./where";
import type { VisibilitySpec } from "@/domains/authz/visibility";

describe("itemVisibilityWhere — spec → Benchmark Item Prisma where", () => {
  it("maps `all` to an unfiltered query (internal staff see every item)", () => {
    expect(itemVisibilityWhere({ scope: "all" })).toEqual({});
  });

  it("maps `assigned` to EXACT (studyId, country) membership — not the study-level projection", () => {
    // Item granularity is membership of the pair-set: a Researcher assigned to
    // (S1, France) sees S1's France items but NOT its Germany items (ADR-0025).
    expect(
      itemVisibilityWhere({
        scope: "assigned",
        pairs: [
          { studyId: "s1", country: "France" },
          { studyId: "s2", country: "Spain" },
        ],
      }),
    ).toEqual({
      OR: [
        { studyId: "s1", country: "France" },
        { studyId: "s2", country: "Spain" },
      ],
    });
  });

  it("fails closed: an `assigned` scope with no pairs yields zero rows, never `{}`", () => {
    const where = itemVisibilityWhere({ scope: "assigned", pairs: [] });
    expect(where).toEqual({ id: { in: [] } });
    expect(where).not.toEqual({});
  });

  it("fails closed: an unrecognised scope yields a zero-row query, never `{}`", () => {
    const rogue = { scope: "everything" } as unknown as VisibilitySpec;
    const where = itemVisibilityWhere(rogue);
    expect(where).toEqual({ id: { in: [] } });
    expect(where).not.toEqual({});
  });
});
