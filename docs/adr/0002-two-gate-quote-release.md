# Two-gate quote release

Client visibility of a Quote requires **two** independent gates, not one:

1. **Per-quote approval** — an analyst quality-checks each quote and approves or rejects it. Rejected quotes return to the same researcher with a reason.
2. **Per-Country release** — approved quotes only become visible to the client once their **Country** is marked complete and released, as a set.

Clients therefore never see a quote that is merely submitted or even merely approved — only released ones. The internal review back-and-forth is never exposed.

Release is **manual but guarded**: an analyst triggers it, and the system only permits release once every Benchmark Item in the Country has at least its per-item Required Quotes approved with nothing left in Draft/Submitted. Release is also **reversible** — a Country can be reopened (withdrawing it from client view) and re-released; the client view always reflects only currently-released data.

We rejected simple per-quote visibility (client sees a quote the moment it's approved) because clients should receive a coherent, complete picture of a Country rather than a partial, shifting trickle that could mislead. This is easy to mistake for over-engineering, so it is recorded here: do not collapse the two gates into one.
