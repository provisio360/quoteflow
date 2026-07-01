import type { Task } from "graphile-worker";
import { fillPendingConversions } from "../../src/lib/quotes/conversion-fill";
import { resolveSweepProvider, describeSweepAlert } from "../../src/domains/quotes/fx-sweep";

// The deferred FX sweep (#10, ADR-0013). Runs on a cron (see worker/index.ts):
// resolves pending conversions for Submitted quotes whose date has closed. A
// fresh provider per run gives the per-date cache a clean, non-stale lifetime.
//
// With FX_PROVIDER_DISABLED set the sweep degrades gracefully (ADR-0043): it runs
// against a NullRateProvider so USD documents still pin `auto` (rate 1, no provider
// needed) and non-USD stay `pending` for a later manual override or the provider
// being switched on. The alert level then reflects intent (info, not the missing
// -key error).
const fillPendingConversionsTask: Task = async (_payload, helpers) => {
  const { provider, disabled } = resolveSweepProvider();
  const { scanned, resolved, stillPending } = await fillPendingConversions(provider);

  helpers.logger.info(
    `fill_pending_conversions: scanned=${scanned} resolved=${resolved} stillPending=${stillPending}`,
  );

  // Intent-aware secondary line (ADR-0013: pending count is the signal, logging
  // -only for v1, no alerting infra yet). Live + none-resolved is an error; a
  // deliberately disabled provider is merely info.
  const alert = describeSweepAlert({ disabled, scanned, resolved, stillPending });
  if (alert !== null) {
    helpers.logger[alert.level](alert.message);
  }
};

export default fillPendingConversionsTask;
