# Featherbase

A free and open-source, metadata-driven app platform in TypeScript — Frappe's core ideas re-imagined on a modern stack (Convex + React + Vite), fused with Glide-style visual workflows and built for an AI-agent-first authoring loop with 100% automated testing.

**Status:** capability 3 (auto-generated UI) — create a DocType in the UI and get a working grid, form, and detail view, all rendered from the stored definition (TanStack Table v8 grid, server-side filter/sort through the repository layer). On capability 2's DocType engine: portable JSON definitions, per-DocType record tables with a fieldIndex sidecar, one repository layer, package-mode codegen, and the promotion/materialization ladder. Research and architecture decisions live in [docs/](docs/).

## Development

```bash
npm install            # workspace install
npm test               # full test matrix (backend + component integration)
npm run test:coverage  # with the 100% line-coverage floor enforced
npm run dev            # vite dev server (apps/web)
```

See [CLAUDE.md](CLAUDE.md) for the full command list and the issue-driven docs workflow.

## Orientation

|                                          |                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/VISION.md](docs/VISION.md)         | Why this exists and what "done" looks like                                                                                            |
| [docs/ROADMAP.md](docs/ROADMAP.md)       | Capability sequence                                                                                                                   |
| [docs/adr/](docs/adr/)                   | Architecture decision records — one small file per decision, with context and consequences                                            |
| [docs/research/](docs/research/)         | The July 2026 research study (Frappe internals, Glide, OSS workflow tools, backend stacks, testing) — preserved verbatim with sources |
| [docs/capabilities/](docs/capabilities/) | Per-capability research → spec → plan, written just-in-time as each is built                                                          |

Part of the **feather** ecosystem ([feather-testing-core](https://www.npmjs.com/package/feather-testing-core), [feather-testing-convex](https://www.npmjs.com/package/feather-testing-convex)).
