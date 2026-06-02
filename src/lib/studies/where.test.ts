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
