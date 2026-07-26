# System Studies — how the veterans handled it

> Study series, 2026-07-26. One document per system that shaped the
> Featherbase design framework
> (`docs/design/data-and-admin-topology.md`), each answering the same four
> questions:
>
> 1. **What key dimensions did they take?** (the core architectural bets)
> 2. **What does that enable them to do?**
> 3. **What are the downsides?**
> 4. **What should Featherbase adopt — and explicitly not adopt?**
>
> "Adopt" verdicts reference the framework's decisions (D1–D19) so each
> lesson lands somewhere concrete.

## The two families

Every system here sits somewhere on one spectrum, and naming it clarifies
everything else:

- **Runtime interpreters** — the model is *data*, read at runtime; there
  is no generated code to drift. Frappe, Salesforce, ServiceNow, NocoBase,
  Directus, Odoo (mostly), ActiveAdmin. Superpower: users change the
  system live; upgrades can't collide with code nobody wrote. Weakness:
  the behavior lives in an engine you must trust and debug indirectly.
- **Code generators** — the model is *input*; the output is code you own
  and refactor. JHipster, ScaffoldHub, Rails scaffolding, and the
  2000s-era XML→EJB MDM generators (AndroMDA, XDoclot-style) this
  project's author built with. Superpower: readable, refactorable,
  no-lock-in code with the whole test pyramid included. Weakness: the
  **round-trip problem** — the moment a human edits the output, the model
  lies, and regeneration becomes a merge conflict.

Featherbase's position (decision **D19** in the design doc): **interpret
at runtime as the source of truth; generate only one-way, derived
artifacts** — typed clients, hook stubs, test skeletons, and (as an
off-ramp, never round-tripped) full eject of a DocType to owned code.

## The studies

| System | Family | One-line reason it's here |
|---|---|---|
| [JHipster](jhipster.md) | generator | model-to-everything incl. the full test pyramid; blueprints; the upgrade merge |
| [Generator family](generator-family.md) | generator | ScaffoldHub, Rails scaffolding/ActiveAdmin/Administrate, XML→EJB MDM — five answers to the round-trip problem |
| [NocoBase](nocobase.md) | interpreter | microkernel, everything-is-a-plugin, data sources as plugins |
| [Salesforce](salesforce.md) | interpreter | metadata multitenancy, packaging, permission sets, admin-as-builder |
| [Jira](jira.md) | interpreter | schemes as reusable config, request types, the two-paradigm cautionary tale |
| [Directus](directus.md) | interpreter | database-first reflection, snapshot/apply, the extension taxonomy |
| [Odoo](odoo.md) | interpreter | module composition over shared models; the upgrade-pain cautionary tale |
| [ServiceNow](servicenow.md) | interpreter | table inheritance, scoped apps, why update sets are the wrong promotion unit |
| [react-admin](react-admin.md) | code-first frontend | the dataProvider adapter ecosystem; guessers — generation as one-way suggestion |
| [Avo](avo.md) | interpreter (of code) | the escape-hatch ladder — "designed so you can't get stuck"; fields as tiny packages |
| [NocoDB](nocodb.md) | interpreter | spreadsheet skin over existing DBs; views as the user-facing unit; virtual columns |

Frappe already has its own deep study:
`../frappe-architecture.md` (+ the two multi-app/multi-DB notes beside
it). Hasura, Medusa, WordPress, VS Code, and Strapi/Payload are covered
inside the design doc's survey (§8) — deep-dives can be added here on
demand.

## Suggested reading order

1. **JHipster** then **Generator family** — they define the generation
   side and D19, and connect to the author's own MDM-generator history.
2. **NocoBase** and **Salesforce** — the two most complete pictures of
   what Featherbase wants to become (open microkernel; governed metadata
   platform).
3. **Jira**, **ServiceNow**, **Odoo** — the veterans' scar tissue:
   scheme indirection, update sets, upgrade pain. Mostly lessons in what
   to avoid and why the framework's D-decisions are shaped the way they
   are.
4. **Directus** and **NocoDB** — Axis C shipped as products, for the
   developer and spreadsheet audiences respectively.
5. **react-admin** and **Avo** — the admired admin-framework pair: the
   adapter/guesser mechanics and the escape-hatch ladder, i.e. how to
   make "simple where possible, never stuck" a designed property.
