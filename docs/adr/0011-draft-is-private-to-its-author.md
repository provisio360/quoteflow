# A Draft Quote is private to its author

A Researcher can see **other** researchers' Quotes on the same Benchmark Item —
real market observations aid coordination (issue #8 AC, moved from #7). But that
visibility begins only when a quote **leaves Draft**. The pool read returns a
researcher's own quotes in any state, plus other authors' quotes **only once they
are Submitted (or later Approved/Rejected)** — never another author's Draft:

```
where benchmarkItemId = :item AND (createdById = :me OR state <> 'Draft')
```

## Why hide other authors' Drafts

A Draft is *"a researcher's in-progress working copy"* (CONTEXT.md: Draft),
saveable with partial data and editable only by its author. The same authorship
boundary that makes writes owner-only makes other authors' Drafts unreadable: a
half-typed, tentative draft price the author may still change is not yet a market
observation — it is a scratchpad. Exposing it to the pool would leak the
*"partial, shifting trickle"* ADR-0002 rejects for clients, one tier down at the
internal level.

The coordination value the AC is after — *"has someone already worked this
dealer?"* — is delivered by **Submitted** quotes. Marking a quote Submitted is
the act that makes it a shared observation; before that it is private.

We rejected showing **every** quote on the item regardless of author or state. It
is the flat reading of the AC and needs no filter, but it contradicts the Draft
definition and re-introduces the shifting-trickle problem internally.

## Consequences

- The pool read filter (`OR createdById = :me`) looks, on a casual reading of the
  AC ("see other researchers' quotes"), like it under-shows. It does not — hiding
  other authors' Drafts is the point. A future engineer who "fixes" the filter by
  removing the clause is exposing private working copies; don't.
- This is an internal-visibility rule only. Client visibility is governed
  separately and far more strictly by the two-gate release model (ADR-0002); a
  client never sees Draft, Submitted, or even merely Approved quotes.
- "Leaves Draft" is expressed as `state <> 'Draft'` so the rule automatically
  covers the Approved/Rejected states the lifecycle gains in #11 without revisit.
