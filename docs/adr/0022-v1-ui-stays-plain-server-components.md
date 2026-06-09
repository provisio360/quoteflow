# v1 UI stays plain server components; Tailwind/shadcn deferred

ADR-0005 named **Tailwind CSS + shadcn/ui** (with TanStack Table and React Hook
Form) as the v1 UI stack. In practice that stack was never adopted: the app has
no Tailwind, no `globals.css`, and none of those libraries installed. All ~16
existing screens are **plain Next.js server components with small `"use client"`
islands**, inline `style={}` objects, and raw `<form action={serverAction}>`
posts; interactivity uses `useActionState` or `useTransition` + `router.refresh()`,
and server actions return discriminated `{ ok, reason }` results the client maps
to messages.

When building the remaining v1 UI (the Admin area, study creation, researcher
quote collection, country release — the screens whose backends shipped without a
front-end), we **deliberately continue in that plain style** and **defer the
design system** rather than introduce it now.

## Why

- **Consistency beats a split codebase.** Introducing shadcn for new screens
  would leave the existing screens inline-styled — two visual languages — or force
  a retrofit of all of them. Either is more scope than "make every workflow
  usable," which is the actual goal before production.
- **No new dependencies, fastest to testable.** The plain pattern is already
  proven across 16 screens and is the most reliable thing for an agent to produce
  (the ADR-0005 "agent-buildability" rationale cuts toward what already works).
- **Audience tolerates it for now.** v1 is an internal staff tool plus one
  client-facing dashboard; visual polish is deferrable without blocking any
  workflow.

## Consequences

- A coherent look-and-feel is a **single, whole-app styling pass after v1** —
  adopt a design system (shadcn or a shared stylesheet) across *all* screens at
  once, not piecemeal. Until then, expect a utilitarian appearance.
- A future engineer or agent seeing this code should **not** "fix" the mismatch
  with ADR-0005 by adding shadcn to a few screens; that divergence is intentional
  and recorded here. This ADR **supersedes the UI-stack portion of ADR-0005**;
  the rest of ADR-0005 stands.

## Scope note (onboarding ownership)

The new screens also fix a gap: there was no way to create a Client (tenant) or
send an invite in-app. We place both under an **Admin area** (Client creation +
invite management), leaving study/import/assignment/release with the
EM/Analyst/Researcher roles — i.e. the Admin owns the tenant + identity lifecycle,
the engagement roles own the work. This matches "Admin is user-administration
only" (CONTEXT.md / ADR-0007) and keeps tenant creation off the engagement path.
