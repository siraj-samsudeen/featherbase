# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

**Layout: single-context.** One `CONTEXT.md` at the repo root (when it exists)
plus `docs/adr/` for decisions. Featherbase is a pnpm monorepo
(`apps/server`, `apps/web`, `packages/shared`), but it is one coherent system
with one shared domain vocabulary — not several independent products — so the
decisions live in one root-level ADR set.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary / ubiquitous language.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
  [ADR 0006](../adr/0006-stack-react-hono-postgres.md) records the current
  stack and supersedes 0001–0004; later ADRs cover topology, record identity,
  and import inference.
- **`CLAUDE.md`** at the repo root already carries the architecture invariants
  and session protocol. Domain docs supplement it; they don't replace it.

If any of these files don't exist, **proceed silently**. Don't flag their
absence; don't suggest creating them upfront. The `/domain-modeling` skill
(reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates
them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CLAUDE.md                          ← invariants + session protocol
├── CONTEXT.md                         ← glossary (created lazily)
├── docs/
│   ├── adr/                           ← all architecture decisions
│   │   ├── 0006-stack-react-hono-postgres.md
│   │   └── 0007-app-and-database-topology.md
│   ├── specs/                         ← feather-spec requirements
│   └── design/                        ← execution plan, requirements framework
├── apps/{server,web}
└── packages/shared
```

If this ever splits into genuinely independent contexts, switch to a root
`CONTEXT-MAP.md` pointing at one `CONTEXT.md` per context, with
context-scoped `docs/adr/` directories alongside them.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor
proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`,
and failing that `docs/GLOSSARY.md`. Don't drift to synonyms the glossary
explicitly avoids — in particular this project uses **Table / Row / Column**,
not the Frappe vocabulary it started from.

If the concept you need isn't in the glossary yet, that's a signal — either
you're inventing language the project doesn't use (reconsider) or there's a
real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0007 (app and database topology) — but worth reopening
> because…_
