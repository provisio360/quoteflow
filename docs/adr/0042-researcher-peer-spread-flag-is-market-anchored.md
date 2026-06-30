# The researcher's live flag is anchored to the peer spread, never the Client Price

With a live USD-per-unit available at entry (ADR-0041), we want to give the
**researcher** real-time feedback that the quote they just typed looks wrong, so
bad data is caught during collection instead of after submit. The obvious design
— flag the new line against its [[Benchmark Item]]'s [[Client Price]], showing
"higher/lower than expected" — is the one we **reject**, because it reverses
ADR-0003 in substance even if the number stays hidden.

## Why not flag against the Client Price

ADR-0003 hides the Client Price from researchers to stop it **anchoring the
quotes they collect**. The worry was never the digits — it is the *steering
signal*. A live "higher than expected → make further inquiries / re-quote" tells
the researcher which direction the answer lies and roughly how far, and invites
them to keep digging **until the flag clears**. The collected evidence then
drifts toward the Client Price.

That is fatal to the QC system's purpose: the Client Price is a **hypothesis**,
competitor quotes are the **independent evidence** meant to validate or refute
it. Steer the evidence to agree with the hypothesis and the [[Price Flag]] and
benchmark comparison merely confirm a number we engineered them to confirm — a
genuinely mispriced Client Price becomes invisible, the one thing the flag exists
to catch. ADR-0014 already considered "make the researcher justify at submit" and
called it impossible for exactly this reason; this ADR records that the
conclusion stands even when only the *direction* is shown.

## Decision

The researcher-facing flag is anchored to the **peer spread** — the other dealer
quotes for the same Benchmark Item that ADR-0003 §3 **already** lets researchers
see (real market observations, not "the answer"):

- **Population.** Other lines for the same Benchmark Item (item + country) that
  carry a USD figure: [[Submitted]] + [[Approved]], converted
  (`auto`/`manual`/`study-rate`). Excludes peer [[Draft]]s (private, ADR-0011)
  and `pending` lines (no USD point).
- **Measure.** The same symmetric percent-difference as ADR-0014, but against the
  peer **median**, with direction shown as higher/lower **than the other
  dealers**. The trigger fraction **reuses the study's [[QC Threshold]]** (one
  knob) — applied to a different reference.
- **Minimum population.** Needs **≥2 converted peers** (a real median) *and* a
  live USD on the new line (a table rate, ADR-0041). With fewer peers, or no live
  USD, the flag is **silent** — only mechanical sanity checks (decimal slip,
  currency/quantity plausibility) fire. It **degrades gracefully**: the first
  quote for an item is never flaggable because nothing yet defines the market.
- **Nature.** A **transient, advisory** nudge — a soft "this sits well outside
  the other dealers — sure?". **Not** stored, **not** in the analyst queue, **no**
  audit, **no** notification, **no** new researcher justification field, and
  **not a hard gate**: the researcher may still submit.

## Two flag systems, deliberately separate

| | Researcher peer-spread flag (this ADR) | Analyst Client-Price [[Price Flag]] (unchanged) |
|---|---|---|
| Reference | peer median (market truth) | Client Price (the answer) |
| When | live at entry | post-conversion |
| Nature | transient nudge, non-blocking | persisted, gates approval, justification loop |
| ADR-0003 | safe (researchers already see peers) | the hidden benchmark, analyst-only |

## Consequences

- **ADR-0003 stands.** A future engineer who sees "researchers get a price flag"
  must not conclude the Client Price may now leak to them — these are two
  different references. The hiding is still the point.
- **The first quote rides unflagged.** Accepted: only the Client Price could flag
  a lone quote, and that is exactly the anchoring we refuse. Peer spread is
  mathematically silent at n<2.
- **One threshold, two uses.** The study [[QC Threshold]] now also tunes the
  peer-spread nudge. If the two ever need independent tuning, a separate spread
  threshold can be added later.
</content>
