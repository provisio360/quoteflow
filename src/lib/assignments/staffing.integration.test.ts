import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Principal } from "@/domains/authz/principal";
import { listActiveResearchers } from "./repository";

// listActiveResearchers backs the EM assignment picker: only ACTIVE INTERNAL
// Researchers are eligible to be assigned to a Country (the same set
// assignResearchers validates against). Runs as the owner like the other repo
// suites (user is identity substrate, not an RLS table).

const em: Principal = { kind: "internal", userId: "staffing-em", role: "EngagementManager" };
const stamp = Date.now();
const ids = {
  active: `staffing-active-${stamp}`,
  deactivated: `staffing-deact-${stamp}`,
  analyst: `staffing-analyst-${stamp}`,
};

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: ids.active, name: "Active Researcher", email: `${ids.active}@x.com`, kind: "internal", role: "Researcher", status: "active" },
      { id: ids.deactivated, name: "Gone Researcher", email: `${ids.deactivated}@x.com`, kind: "internal", role: "Researcher", status: "deactivated", deactivatedAt: new Date() },
      { id: ids.analyst, name: "An Analyst", email: `${ids.analyst}@x.com`, kind: "internal", role: "Analyst", status: "active" },
    ],
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
});

describe("listActiveResearchers", () => {
  it("returns only active internal Researchers", async () => {
    const got = (await listActiveResearchers(em)).map((r) => r.id);
    expect(got).toContain(ids.active);
    expect(got).not.toContain(ids.deactivated);
    expect(got).not.toContain(ids.analyst);
  });
});
