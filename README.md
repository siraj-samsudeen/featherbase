# Featherbase

A free and open-source, metadata-driven app platform in TypeScript — Frappe's core ideas rebuilt on React + Hono + Postgres, with an AI-agent-first authoring loop and tests that run against a real database.

Define a DocType once and get storage, a REST/RPC API, and a working UI from the same definition — the idea that makes [Frappe](https://frappe.io/framework) productive, on a stack you can host anywhere.

**Status:** active development. The DocType engine, the Frappe-compatible API surface, auth, and the metadata-driven Desk UI are working, exercised by a 320-test server suite and a component suite. See [PROGRESS.md](PROGRESS.md) for the current state and [docs/ROADMAP.md](docs/ROADMAP.md) for where it's going.

## How it works

| Workspace | Role |
|---|---|
| `apps/server` | Hono API — DocType engine, Frappe-compatible REST and `frappe.client.*` RPC, sessions |
| `apps/web` | React Desk UI — metadata-driven grid, form, and detail views |
| `packages/shared` | Types and contracts shared across server and web |

Tests use [feather-testing-postgres](https://github.com/siraj-samsudeen/feather-testing-postgres), the SQL Sandbox harness, consumed as a published npm dependency rather than vendored here.

Frappe compatibility is deliberate: sessions ride an HttpOnly `sid` cookie alongside a Bearer token, `POST /api/method/login` returns Frappe's shape, and error bodies carry `exc_type`. Existing Frappe clients mostly work unchanged.

## Testing

Every test runs inside a real Postgres transaction that is rolled back at the end — Phoenix's Ecto SQL Sandbox model. No mocks, no fixture files, no cleanup code, and the production code path is what gets exercised. The harness is a workspace package and is published standalone for use outside this repo.

## Getting started

```bash
pnpm install
./init.sh        # provision the database
pnpm test        # run every suite
pnpm smoke       # server + web smoke tests
```

## Orientation

- [docs/VISION.md](docs/VISION.md) — what this is for and who it serves
- [docs/ROADMAP.md](docs/ROADMAP.md) — replication strategy and sequencing
- [docs/adr/](docs/adr/) — architecture decisions, including [ADR 0006](docs/adr/0006-stack-react-hono-postgres.md) on the move to Postgres
- [docs/research/](docs/research/) — Frappe architecture, Glide, and stack studies
- [docs/archive/convex-capabilities/](docs/archive/convex-capabilities/) — the retired Convex implementation's specs

## History

Featherbase was first built on Convex ([ADR 0001](docs/adr/0001-stack-convex-react-vite.md)) and reached a working sign-in capability before being rebuilt on Postgres. [ADR 0006](docs/adr/0006-stack-react-hono-postgres.md) records why. The Convex implementation is preserved on the `archive/convex-v1` tag.

## Part of Feather

Featherbase is the app-platform framework in the [Feather family](https://github.com/siraj-samsudeen/feather-framework).

## License

MIT
