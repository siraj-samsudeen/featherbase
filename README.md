# Featherbase

A free and open-source, agent-first, self-hostable application framework and runtime in TypeScript — built by replicating [Frappe Framework](https://frappe.io/framework)'s core ideas on React + Hono + Postgres, with tests that run against a real database. That replication phase is complete; the project is now deliberately diverging from Frappe's design — including its vocabulary and wire format — where it doesn't serve this platform's own users.

Define a Table once and get storage, a REST/RPC API, and a working UI from the same definition — the idea that makes Frappe productive, on a stack you can host anywhere.

**Status:** active development. The Table engine, the API surface, auth, and the metadata-driven Admin UI are working, exercised by a large server suite run against a real Postgres, plus component and Playwright e2e suites. See [PROGRESS.md](PROGRESS.md) for the current state and [docs/ROADMAP.md](docs/ROADMAP.md) for where it's going.

## What Featherbase is

Featherbase is designed around three principles: deployable application ownership, agent-first declarative development with code escape hatches, and framework capabilities extracted from proven repetition.

### Deployable application ownership

A customer can clone Featherbase, develop one or more applications inside that repository, and deploy the complete system on infrastructure they control. The same application package can instead live in a separate repository and be installed into Featherbase.

Applications are portable units. An application may begin inside a shared Featherbase deployment and later move to its own deployment as usage, operational requirements, or ownership changes. Its package must declare the code, data structures, owned data, files, configuration, permissions, dependencies, and migrations needed to move it. An external application can likewise be brought into the main repository without changing its application model.

Featherbase may be offered as a managed service, but the managed service runs the same self-hostable product. The initial deployment model is one customer per Featherbase installation, not unrelated customers sharing one application database.

### Agent-first development

Featherbase is designed primarily for applications built by coding agents. Repetitive application work—data models, permissions, workflows, forms, pages, audit, files, actions, installation, and upgrades—should be expressed through durable, validated declarations. Domain-specific behaviour remains ordinary TypeScript, React, SQL, or another documented extension.

Declarations remain the source of truth; they are not one-time code generation. Custom code connects through explicit extension points rather than replacing the framework's common behaviour.

### Extract capabilities from proven repetition

When multiple applications repeat the same custom implementation, agents should be able to identify that repetition and propose a reusable Featherbase capability. Capabilities enter the framework after being proven by real applications, rather than through speculative generalisation.

Featherbase guarantees upgrade compatibility at its documented declarative and code extension points. Direct core modifications remain possible in a self-hosted system, but they are owned by that deployment and do not carry the same compatibility guarantee.

Featherbase is not a shared multi-tenant SaaS product, a human-oriented no-code builder, or a one-time application generator. It is a self-hostable framework that gives coding agents reusable application primitives without limiting their ability to write normal code.

## Why this shape

The comparisons below describe Featherbase's design direction, not a claim that every contract is already complete. Featherbase is in active development; Salesforce, Airtable, Shopify, Frappe, and JHipster are mature products or ecosystems with capabilities and operational experience Featherbase does not yet have.

### Shared SaaS or customer-owned deployment

Salesforce and Airtable operate the application platform for their customers. A customer can begin without running infrastructure, receives platform upgrades automatically, and benefits from mature operations, integrations, and ecosystems. Shared operation also lets those platforms improve security, reliability, and performance centrally.

That model makes the provider's runtime, limits, release decisions, and commercial terms part of every application. Data can be exported, but moving the complete application—its behaviour, extensions, and operating environment—to an independent deployment is not the normal product model.

Featherbase chooses customer-owned deployment. A customer may operate it directly or pay someone to manage the same self-hostable product. This provides deployment control and makes moving an application between Featherbase installations a platform requirement. The cost is real: each installation must be deployed, monitored, backed up, and upgraded, and Featherbase does not initially receive the economies of a shared SaaS runtime.

### Human visual building or agent-authored declarations

Salesforce and Airtable provide mature visual tools through which nontechnical users can create data models, views, automations, and permissions. This shortens the path from a business need to a working system and allows many changes without a software delivery process.

As requirements become more specialised, builders work within each platform's supported components, APIs, limits, and proprietary development model. Complex applications can accumulate configuration that is difficult to review, test, and reproduce as one source-controlled artifact.

Featherbase optimizes instead for coding agents. Durable declarations describe the repetitive parts of an application and ordinary code handles the parts that are genuinely specific. The declarations remain diffable, testable application source rather than the transient output of a visual editing session. The trade-off is that Featherbase requires a coding agent or developer; it is not intended to provide Airtable-like self-service to a nontechnical builder.

### Governed extension platform or trusted application code

Salesforce tightly governs package code inside its runtime. Shopify exposes stable APIs and extension surfaces while most app backends run outside Shopify. These boundaries protect the host platform, make central upgrades possible, and support large third-party ecosystems. They also constrain which execution models, interfaces, and integrations an application may use.

Featherbase applications are trusted code running on a customer's own installation. They can contribute declarations and use documented server, client, migration, job, and file extension points without an artificial shared-SaaS sandbox. This gives an application normal programming power, but also normal programming risk: a faulty application can consume resources, fail startup, or affect the installation. The operator owns the applications they install.

### Generated application or durable runtime declaration

JHipster demonstrates the strength of generation: describe an application and receive an ordinary standalone codebase, including broad infrastructure and tests, with no JHipster runtime in production. Its output can be changed without framework restrictions.

The corresponding cost is the round-trip problem. Once generated code has been edited, regenerating from a changed model or upgrading the generator can require substantial merging, and the declaration may stop being the source of truth.

Featherbase keeps declarations authoritative and interprets them at runtime. Improvements to a shared primitive can therefore benefit every application that declares it, while custom code remains attached through named extension points. Applications retain a runtime dependency on Featherbase, and Featherbase must keep those extension contracts stable.

### Established framework or emerging framework

Frappe is Featherbase's closest architectural predecessor. It offers a mature metadata engine, installed applications, generic administration, workflows, permissions, jobs, files, and a large body of production and operational knowledge. Choosing Frappe today provides far more completed capability and ecosystem depth than choosing Featherbase.

Featherbase began by replicating Frappe's core ideas on React, Hono, and Postgres, then diverged around a different primary builder: the coding agent. Its direction emphasizes machine-readable application contracts, portable app ownership, durable declarations, and explicit code extension boundaries. The cost is immaturity: important contracts are still being designed and proved, the ecosystem is small, and early adopters participate in discovering what belongs in the framework.

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
