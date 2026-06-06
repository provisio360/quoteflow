import type { Task } from "graphile-worker";
import { fillPendingConversions } from "../../src/lib/quotes/conversion-fill";
import { exchangerateApiProviderFromEnv } from "../../src/domains/quotes/exchangerate-api-provider";

// The deferred FX sweep (#10, ADR-0013). Runs on a cron (see worker/index.ts):
// resolves pending conversions for Submitted quotes whose date has closed. A
// fresh provider per run gives the per-date cache a clean, non-stale lifetime.
const fillPendingConversionsTask: Task = async (_payload, helpers) => {
  const provider = exchangerateApiProviderFromEnv();
  const { scanned, resolved, stillPending } = await fillPendingConversions(provider);

  helpers.logger.info(
    `fill_pending_conversions: scanned=${scanned} resolved=${resolved} stillPending=${stillPending}`,
  );

  // No quote resolved despite candidates is the signature of a dead key / blown
  // quota / inactive account — log loudly (ADR-0013: pending count is the signal,
  // logging-only for v1, no alerting infra yet).
  if (scanned > 0 && resolved === 0) {
    helpers.logger.error(
      `fill_pending_conversions: ${scanned} pending quote(s) but none resolved — check EXCHANGERATE_API_KEY, quota, and account status`,
    );
  }
};

export default fillPendingConversionsTask;
