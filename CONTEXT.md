# Featherbase

A metadata-driven low-code app platform: you define a **Table** as metadata, and
the database table, API, forms, list views, validation and access rules are all
generated from that one definition.

This file is the **ubiquitous language** — the words this project uses, and the
words it has deliberately retired. It is a glossary and nothing else: no file
paths, no implementation notes. For decisions, see [docs/adr/](docs/adr/).

Featherbase began as a faithful replication of
[Frappe Framework](https://frappe.io/framework) and has since diverged on
purpose. Most `_Avoid_` entries below are Frappe's words. Using them to describe
*this* platform in the present tense is drift; using them to describe its
history is accurate and fine.

## Core model

**Table**:
A model defined as metadata — the central concept. Everything else in the
platform is generated from it.
_Avoid_: DocType, entity, model, schema

**Row**:
One record in a Table.
_Avoid_: Document, Doc

**Column**:
One attribute of a Table: a name, a type, and flags.
_Avoid_: Field, docfield, attribute

**Sub-table**:
A Table whose Rows exist only inside a parent Row, reached through a parent
Column of type Sub-table.
_Avoid_: child table, grid, nested table

**Settings Table**:
A Table with exactly one instance and no generated database table — think
System Settings.
_Avoid_: Single, Single DocType

## Identity

> **Live inconsistency (checked 30-Oct-2026, #705).** [ADR 0009](docs/adr/0009-record-identity-id-and-name.md)
> ratified the two terms below. The rename has landed, but the key column is
> `row_id` (shown as "Row ID"), not `id`
> ([#132](https://github.com/siraj-samsudeen/featherbase/issues/132)), while the
> **ID** entry below still says `id` and lists `row_id` under _Avoid_. `name` is
> no longer reserved and means the human-readable name, as below. Which wording
> the entry should carry is the owner's call.

**ID**:
A Row's primary key — the platform's own identifier for it. Always the bare
column `id`, never domain-prefixed.
_Avoid_: name (as identity), pk, row_id, docname

**Name**:
The human-readable name of a Row — an ordinary user Column that a Table may or
may not have.
_Avoid_: title (when you mean the name column)

**Id pattern**:
The rule that assigns a new Row its ID — a sequence, a hash, a prompt, or a
copy of another Column's value.
_Avoid_: naming series, autoname, naming rule

## Access control

**Permission**:
A role-based grant on a Table — which role may read, write, create, delete,
submit, cancel or amend, at which Tier.
_Avoid_: DocPerm, ACL, role permission

**Tier**:
A per-Column permission level, either `basic` or `restricted`.
_Avoid_: permlevel, permission level, sensitivity

**Own rows only**:
A Permission flag restricting a grant to Rows the user created.
_Avoid_: if_owner, owner-only

**Data Scope**:
A per-principal restriction limiting which Rows a person or a service account
may see, expressed against a Reference Column's value.
_Avoid_: User Permission, row-level filter, tenant scope

**Share**:
A one-off grant of a single Row to a specific person or service account,
outside the Permission matrix.
_Avoid_: DocShare

## People

**Person**:
One human's record — whether or not they ever use Featherbase. Its id is a
permanent opaque reference Featherbase assigns (`psn_…`), never an address, a
username or an employee code. Administrator and Guest are the two built-in
persons and keep their ids.
_Avoid_: User (for the record), account (when the human is meant)

**Service Account**:
An automation account: its own kind of principal, never a person. It has no
password, no sign-in method and no email; it authenticates only by access
token, and holds roles, Data Scope and Shares exactly as a person does.
_Avoid_: bot user, service user

**Principal**:
Whoever a request acts as: a Person or a Service Account. Tokens, Data Scope,
Shares and roles name a principal through a `person` / `service_account` pair,
exactly one set.

**Sign-in identity**:
A way a person signs in through an outside provider (a Google account, an HR
system login), keyed by the provider's permanent id. It *signs in*; it may
end (left, moved, unlinked) and then never opens the account again.
_Avoid_: identifier (for this)

**Identifier**:
A value a person has or had in some namespace — an employee code, an HR
record number, a phone, an address — with the period it was valid and where it
came from. It does *not* sign anyone in.
_Avoid_: identity (for this), alias

**Identifier System**:
One namespace of identifier values, configured by its kind (employee record,
external record, national ID, contact) and its Sensitivity (Normal,
Restricted, Restricted-hidden, Secret).

**Record number**:
Another system's own permanent key for its record of a person — StyleHR's
employee record id — as opposed to the employee code, which can change and is
reused across firms.
_Avoid_: employee id (ambiguous)

## Column types

**Reference**:
A Column pointing at another Table, holding a target Row's ID.
_Avoid_: Link, foreign key, relation, lookup

**Choice**:
A Column restricted to a fixed list of values.
_Avoid_: Select, enum, dropdown

## Surfaces

**Admin**:
The back-office UI where operators work with Rows and build Tables.
_Avoid_: Desk, backend, dashboard

**Portal**:
The customer-facing counterpart to the Admin, where a logged-in user sees only
their own Rows.
_Avoid_: front-end, customer site

**Home Page**:
A curated module landing page, and the Admin sidebar's unit of navigation.
_Avoid_: Workspace, dashboard, module page

**Command Bar**:
The Admin's global search and command palette.
_Avoid_: Awesomebar, omnibox, quick search

**Web Form**:
A public, optionally anonymous form over a whitelisted subset of one Table's
Columns.
_Avoid_: public form, survey

**Glossary**:
The words an instance's Apps use and what they mean, readable by everyone
signed in. An App ships its terms; an instance adds its own and may reword an
App's.
_Avoid_: dictionary, help pages

**Glossary term**:
One word in the Glossary: a definition, with examples, words to avoid and the
Tables or Columns it describes where they help.
_Avoid_: definition entry, tooltip

## Platform, apps and instances

These are the three layers of ADR 0011. Each layer knows only the layer below it.

**Platform**:
Featherbase itself: sign-in, Tables, forms, roles, the Admin screens, and the
rules for installing apps. It is the same for every client, and it never names a
client or an app.
_Avoid_: core (as a layer name), framework

**App**:
Something installed on an instance, with its own pages, Tables, roles and code.
It reaches the platform only through declared extension points. It comes in two
kinds, product apps and client apps (ADR 0013).
_Avoid_: runtime package (the code's name, used only when pointing at a file),
plugin, module

**Product app**:
An app meant for any client, shipped with Featherbase as a first-party package.
A client's values reach it as settings or instance setup; it never hard-codes one
client's values. Worth it when the same app serves many clients. For example,
Feather Tickets or Feather Tasker.
_Avoid_: generic app, universal app

**Client app**:
An app built for one client, kept in that client's own repository. It may carry
the client's terms, values and examples directly. The next client gets a copy to
adapt. Quicker to build and easier to follow; the cost is that the copies drift
apart. For example, Feather Dash, built for its first client.
_Avoid_: custom app, bespoke app, instance app

**Instance**:
One running copy of Featherbase for one client: one server, one database, and
that client's settings, data, people and choice of apps.
_Avoid_: site, tenant, deployment (as the layer name)

## Extension

**Workflow**:
A role-gated state machine over a Table, whose states map to a Row's status.
_Avoid_: state machine (as the user-facing word), approval chain

**Server Script**:
Admin-authored code that runs on the server without a deploy — on an automation
trigger, or as a callable API method.
_Avoid_: hook, server hook, trigger script

**Client Script**:
Admin-authored JavaScript that hooks into form events in the browser.
_Avoid_: custom script, form script

**Custom Field**:
A Column added to an existing Table as data rather than by editing the Table's
definition, so it survives upstream re-seeds.
_Avoid_: extra field, ad-hoc column

**Metadata Override**:
A stored override of a single metadata property — a label, a flag — applied as
an overlay without touching the base definition.
_Avoid_: Property Setter, Field Override, customization

**Automation trigger**:
A named point in a Row's save lifecycle where scripts run: on check, before
saving, after saving.
_Avoid_: hook, lifecycle event, doc event

## Reporting

**Summary View**:
A saved list configuration — filters, columns, sort — over one Table.
_Avoid_: Report View, saved view

**Code Report**:
A report whose rows and charts are produced by admin-authored code.
_Avoid_: Script Report

**PDF Template**:
A per-Table layout used to render a Row as a PDF.
_Avoid_: Print Format, print template
