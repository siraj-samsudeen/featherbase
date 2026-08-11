# Featherbase

A metadata-driven low-code app platform: you define a **Table** as metadata, and
the database table, API, forms, list views, validation and access rules are all
generated from that one definition.

This file is the **ubiquitous language** — the words this project uses, and the
words it has deliberately retired. It is a glossary and nothing else: no file
paths, no implementation notes. For "where does this live in the code", see
[docs/GLOSSARY.md](docs/GLOSSARY.md); for decisions, see [docs/adr/](docs/adr/).

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

> **Live inconsistency.** [ADR 0009](docs/adr/0009-record-identity-id-and-name.md)
> ratified the two terms below, but the rename has not landed in the code yet —
> the primary key column is still literally `name`
> ([#89](https://github.com/siraj-samsudeen/featherbase/issues/89) is open).
> Until it lands, `name` in code means identity, while `name` in this glossary
> means the human-readable name. Prefer the language below when writing prose,
> specs, and issue titles; expect the old meaning when reading code.

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
A per-user restriction limiting which Rows a user may see, expressed against a
Reference Column's value.
_Avoid_: User Permission, row-level filter, tenant scope

**Share**:
A one-off grant of a single Row to a specific user or role, outside the
Permission matrix.
_Avoid_: DocShare

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

**SQL Report**:
A saved, parameterized SQL query presented as a report.
_Avoid_: Query Report

**Code Report**:
A report whose rows and charts are produced by admin-authored code.
_Avoid_: Script Report

**PDF Template**:
A per-Table layout used to render a Row as a PDF.
_Avoid_: Print Format, print template
