# Featherbase

A free and open-source, metadata-driven app platform in TypeScript — built by replicating [Frappe Framework](https://frappe.io/framework)'s core ideas on React + Hono + Postgres, with an AI-agent-first authoring loop and tests that run against a real database. That replication phase is complete; the project is now deliberately diverging from Frappe's design — including its vocabulary and wire format — where it doesn't serve this platform's own users.

Define a Table once and get storage, a REST/RPC API, and a working UI from the same definition — the idea that makes Frappe productive, on a stack you can host anywhere.

**Status:** active development. The Table engine, the API surface, auth, and the metadata-driven Admin UI are working, exercised by a large server suite run against a real Postgres, plus component and Playwright e2e suites. See [PROGRESS.md](PROGRESS.md) for the current state and [docs/ROADMAP.md](docs/ROADMAP.md) for where it's going.

## How it works

| Workspace | Role |
|---|---|
| `apps/server` | Hono API — Table engine, REST/RPC API, sessions |
| `apps/web` | React Admin UI — metadata-driven grid, form, and detail views |
| `packages/shared` | Types and contracts shared across server and web |

Tests use [feather-testing-postgres](https://github.com/siraj-samsudeen/feather-testing-postgres), the SQL Sandbox harness, consumed as a published npm dependency rather than vendored here.

Frappe wire-format compatibility is **not** a goal — that's a deliberate divergence, not an oversight (see [ADR 0006](docs/adr/0006-stack-react-hono-postgres.md)'s addendum). The vocabulary and API surface here are Featherbase's own.

## Testing

Every test runs inside a real Postgres transaction that is rolled back at the end — Phoenix's Ecto SQL Sandbox model. No mocks, no fixture files, no cleanup code, and the production code path is what gets exercised. The harness lives in [its own repo](https://github.com/siraj-samsudeen/feather-testing-postgres) and is consumed here as a published npm dependency.

## Getting started

```bash
pnpm install
./init.sh        # provision the database
pnpm test        # run every suite
pnpm smoke       # server + web smoke tests
pnpm test:all    # every suite + Playwright e2e — needs both servers up (./init.sh)
```

## Orientation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the life of a row-save request, the metadata engine, and a map of the source tree
- [docs/TUTORIAL.md](docs/TUTORIAL.md) — build your first Table: a hands-on todo-list exercise
- [docs/TESTING.md](docs/TESTING.md) — the SQL-sandbox test model and the three test layers
- [docs/GLOSSARY.md](docs/GLOSSARY.md) — Featherbase's own vocabulary
- [docs/VISION.md](docs/VISION.md) — what this is for and who it serves
- [docs/ROADMAP.md](docs/ROADMAP.md) — strategy and sequencing, across both the replication and divergence phases
- [docs/adr/](docs/adr/) — architecture decisions, including [ADR 0006](docs/adr/0006-stack-react-hono-postgres.md) on the move to Postgres
- [docs/research/](docs/research/) — Frappe architecture, Glide, and stack studies
- [docs/archive/convex-capabilities/](docs/archive/convex-capabilities/) — the retired Convex implementation's specs

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, and working conventions.

## History

Featherbase was first built on Convex ([ADR 0001](docs/adr/0001-stack-convex-react-vite.md)) and reached a working sign-in capability before being rebuilt on Postgres. [ADR 0006](docs/adr/0006-stack-react-hono-postgres.md) records why. The Convex implementation is preserved on the `archive/convex-v1` tag.

## Part of Feather

Featherbase is the app-platform framework in the [Feather family](https://github.com/siraj-samsudeen/feather-framework).

## License

MIT
