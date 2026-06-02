// Pure decision core — no framework, DB, or network imports.
// Establishes the convention every domain module follows: testable in isolation.

export type HealthStatus = "ok" | "degraded" | "down";

export interface HealthInputs {
  dbOk: boolean;
  queueOk?: boolean;
}

export interface Health {
  status: HealthStatus;
  checks: { db: boolean; queue: boolean };
}

/**
 * Derive overall system health from individual subsystem checks.
 * - all pass        -> "ok"
 * - some pass       -> "degraded"
 * - none pass       -> "down"
 */
export function deriveHealth({ dbOk, queueOk = true }: HealthInputs): Health {
  const passing = [dbOk, queueOk].filter(Boolean).length;
  const status: HealthStatus =
    passing === 2 ? "ok" : passing === 0 ? "down" : "degraded";

  return { status, checks: { db: dbOk, queue: queueOk } };
}
