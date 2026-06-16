import { describe, it, expect } from "vitest";
import { visibilityWhere } from "./where";
import type { VisibilitySpec } from "@/domains/authz/visibility";

describe("visibilityWhere — spec → Prisma where", () => {
  it("maps `all` to an unfiltered query (internal staff see everything)", () => {
    expect(visibilityWhere({ scope: "all" })).toEqual({});
  });

  it("maps `tenant` to a clientId filter (the isolation boundary)", () => {
    expect(visibilityWhere({ scope: "tenant", tenantId: "t1" })).toEqual({
      clientId: "t1",
    });
  });

  it("maps `assigned` to the studies a Researcher holds >=1 assignment in (the ∃ studyId projection)", () => {
    // Study-level visibility is the projection of item-level membership onto
    // studyId: a pair in S1 makes S1 visible, whatever its country (ADR-0025).
    expect(
      visibilityWhere({
        scope: "assigned",
        pairs: [
          { studyId: "s1", country: "France" },
          { studyId: "s1", country: "Germany" },
          { studyId: "s2", country: "Spain" },
        ],
      }),
    ).toEqual({ id: { in: ["s1", "s2"] } });
  });

  it("fails closed: an `assigned` scope with no pairs yields zero rows, never `{}`", () => {
    const where = visibilityWhere({ scope: "assigned", pairs: [] });
    expect(where).toEqual({ id: { in: [] } });
    expect(where).not.toEqual({});
  });

  it("fails closed: an unrecognised scope yields a zero-row query, never `{}`", () => {
    // A future variant slipping through without a handler. The `never` check
    // makes this a compile error; this proves the runtime guard denies rather
    // than opening the query to every tenant.
    const rogue = { scope: "everything" } as unknown as VisibilitySpec;
    const where = visibilityWhere(rogue);
    expect(where).toEqual({ id: { in: [] } });
    expect(where).not.toEqual({}); // the catastrophic "see all" must NOT happen
  });
});
