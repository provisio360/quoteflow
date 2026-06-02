// Pure decision core — no framework, DB, or network imports.
//
// The upsert resolver (issue #5). Given the validated items from `validateImport`
// and the set of keys ALREADY present in the target study, it partitions them
// into inserts and updates on the Benchmark Item identity — (canonical country +
// folded client part number) — per ADR-0009. The repository supplies the
// existing-key set from a query and performs the writes; the insert/update
// decision itself stays pure and testable here.

import { benchmarkItemKey, type ValidatedBenchmarkItem } from "./import";

// The upsert key has a single definition in ./import (used for in-file duplicate
// detection too); re-exported here so the repository imports it alongside the
// resolver it pairs with.
export { benchmarkItemKey };

export interface ResolvedUpserts {
  readonly inserts: readonly ValidatedBenchmarkItem[];
  readonly updates: readonly ValidatedBenchmarkItem[];
}

/**
 * Split validated items into those that already exist in the study (updates)
 * and those that do not (inserts). Import never deletes — items absent from the
 * file but present in the study are simply not referenced here (ADR-0009).
 */
export function resolveUpserts(
  items: readonly ValidatedBenchmarkItem[],
  existingKeys: ReadonlySet<string>,
): ResolvedUpserts {
  const inserts: ValidatedBenchmarkItem[] = [];
  const updates: ValidatedBenchmarkItem[] = [];
  for (const item of items) {
    if (existingKeys.has(benchmarkItemKey(item))) updates.push(item);
    else inserts.push(item);
  }
  return { inserts, updates };
}
