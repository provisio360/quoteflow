import type { Principal } from "@/domains/authz/principal";
import { isRole } from "@/domains/authz/principal";
import { countryVisibility, type VisibilitySpec } from "@/domains/authz/visibility";
import type { TenantClient } from "@/lib/tenant-context";

// The thin IO adapter for the country-visibility axis (ADR-0025). The pure
// decision (`countryVisibility`) needs the Researcher's assigned (study, country)
// pair-set; this resolves it from the database, in the caller's open transaction.
//
// ONE resolver, reused by every Researcher read path (studies list, study detail,
// item list), so the SINGLE pair-set drives both the study-level projection and
// the item-level membership — they cannot drift (ADR-0025).

/**
 * Resolve the principal's country-visibility spec.
 *
 * Short-circuits to `all` for every non-Researcher (EM / Analyst / Admin keep
 * full `all`; a client user is already terminal on the tenant axis) WITHOUT a DB
 * read — their assignment data is never loaded. For a Researcher, loads their
 * Country Assignments in the same transaction and returns the `assigned` pair-set;
 * a Researcher with none gets an empty set, which fails closed downstream (zero
 * rows), never `all`.
 */
export async function resolveCountryVisibility(
  principal: Principal,
  tx: TenantClient,
): Promise<VisibilitySpec> {
  if (!isRole(principal, "Researcher")) return { scope: "all" };
  const pairs = await tx.countryAssignment.findMany({
    where: { researcherId: principal.userId },
    select: { studyId: true, country: true },
  });
  return countryVisibility(principal, pairs);
}
