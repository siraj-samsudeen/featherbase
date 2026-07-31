# react-admin — the adapter pattern on the frontend, and guessers

> Study, 2026-07-26. Family: **code-first frontend framework** (neither
> pure interpreter nor generator — it occupies a third position worth
> understanding precisely). Marmelab's open-source framework for B2B/admin
> single-page apps; ~20 years of agency scar tissue distilled into one
> library.

## What it is

A React frontend framework for admin and B2B apps over *any* API: you
compose `<List>`, `<Edit>`, `<Create>`, `<Show>` components per resource,
and all data access flows through a **dataProvider** — a standardized
CRUD interface with 50+ community adapters (REST flavors, GraphQL,
Supabase, Hasura, Firebase, local storage). The core (`ra-core`) is
headless hooks; the Material-UI layer (and newer shadcn distribution) sits
on top.

## Key dimensions

1. **The dataProvider: a frontend driver model.** One interface
   (`getList`, `getOne`, `create`, `update`, `delete`, …) decouples the
   entire UI from the backend. Featherbase's Axis B adapter interface is
   the same idea placed server-side — react-admin proves the shape works
   and that a 50-adapter ecosystem can grow around a stable interface.
   The **authProvider** does the same for identity (Axis G's pluggable
   principal sources, on the client).
2. **Code-first composition, not metadata.** A resource's screens are JSX
   you write. No schema drives the UI — the developer is the interpreter.
   This is the opposite bet from Featherbase's generic Desk, chosen
   because react-admin's customer is a developer building a *bespoke*
   admin, not an end user creating DocTypes.
3. **Guessers: generation as a one-way suggestion.** `<ListGuesser>`
   introspects actual API responses at runtime, renders a sensible UI,
   and **prints the equivalent JSX to the console for you to paste and
   own**. This is the most elegant resolution of the
   generation-vs-interpretation tension in the whole study series:
   interpretation for the first render, generation as *copyable output*,
   zero round-trip problem because the tool never touches your files.
4. **Headless core / replaceable skin.** `ra-core` hooks carry all logic;
   the component layer is swappable (Material UI, shadcn). Logic and
   presentation are separate packages, so the design system can age
   without the framework aging.
5. **Optimistic rendering with undo.** Mutations apply instantly in the
   UI, are undoable for a few seconds, and only then hit the API — a
   deliberate UX stance on latency and mistakes.
6. **Open-core:** solid free core; enterprise modules (RBAC, realtime,
   audit log, tree views) fund the company — a sustainable OSS economics
   reference for Featherbase itself.

## What it enables

- One admin-building skill that survives every backend the agency meets —
  the adapter interface *is* the product.
- Instant start (guessers) with a no-cliff path to full custom code —
  "simple where possible, refactorable always", achieved from the code
  side rather than the metadata side.
- A huge ecosystem (adapters, tutorials, hires) around a small stable
  contract.

## Downsides

- **No runtime authoring at all**: every screen is developer-written
  code; an admin can't add a field, ever. It's a framework for building
  admins, not a platform — the gap Featherbase exists to fill.
- Per-resource JSX accumulates into exactly the repetitive surface
  metadata-driven systems eliminate; DRY discipline is on the team.
- The Material-UI default reads "generic admin" out of the box; real
  products restyle (hence the shadcn distribution).
- Enterprise-module boundary means some table-stakes features (RBAC,
  audit) are paid — fine as economics, friction as adoption.

## What Featherbase should adopt

- **Guessers, verbatim (D19's missing UX):** the Desk's generic
  ListView/FormView *is* the guesser; add the "eject this view" button
  that emits the equivalent explicit layout (or component code, tier-1)
  for the case where a screen needs to become bespoke. One-way, copy-out,
  no round-trip — react-admin proved users understand this contract
  instantly.
- **Headless separation for the Desk (Axis D):** keep view logic in
  hooks/services separate from the `.fc-*`-styled components, so UI
  contributions (D11) can reuse logic without inheriting markup, and a
  future design-system swap doesn't touch behavior.
- **Optimistic-with-undo** as the Desk's mutation UX for low-risk edits —
  it's the best-feeling answer to server-mediated writes (invariant 2)
  without lying about latency.
- **dataProvider ecosystem mechanics (D7/D15):** a small, stable,
  documented adapter contract + a community listing is what turned 50
  backends into a strength; the driver conformance suite is Featherbase's
  version of that contract made executable.

**Do not adopt:** code-as-the-only-authoring-mode (the generic Desk is
the product); UI-side data drivers as the *primary* integration (drivers
belong server-side behind permissions — invariant 2 — with react-admin's
pattern reserved for the client talking to *our* API).
