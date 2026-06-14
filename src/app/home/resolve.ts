import type { Principal } from "@/domains/authz/principal";

// The home page's single branching decision: which per-category view a request
// gets. Kept as a pure function so the exhaustive mapping is testable in the
// node test env (the JSX components that consume it stay thin and untested,
// per repo convention). #55: this slice lays the shell; each view's derived
// signals land in their own follow-up slices.
export type HomeView =
  | "logged-out"
  | "admin"
  | "engagement-manager"
  | "researcher"
  | "analyst"
  | "client";

export function resolveHomeView(principal: Principal | null): HomeView {
  if (principal === null) return "logged-out";
  if (principal.kind === "client") return "client";

  switch (principal.role) {
    case "Admin":
      return "admin";
    case "EngagementManager":
      return "engagement-manager";
    case "Researcher":
      return "researcher";
    case "Analyst":
      return "analyst";
  }
}
