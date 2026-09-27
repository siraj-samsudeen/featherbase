# Featherbase capability status

Featherbase is an agent-first application framework: agents declare recurring
application behavior and write ordinary code for the parts that are genuinely
custom. This page is the compact map of what agents can reuse today and what is
still being built.

Status is judged against the **portable application contract**. A capability is
only Available when an installed application can reuse it without rebuilding
the behavior in its own client. Where Featherbase's generic Admin already has
the behavior but applications cannot yet declare it, the status is Partial.

## Status key

- **✓ Available** — reusable by an installed application now.
- **◐ Partial** — useful platform behavior exists, but the portable application
  contract is incomplete.
- **◇ Planned** — tracked for delivery, but not available yet.
- **○ Not started** — agreed direction, with no accepted specification yet.
- **! Blocked** — work cannot proceed until a named dependency or decision is
  resolved.

The portal adds colour to these labels: green, yellow, blue, grey and red
respectively. The words and symbols are the source of truth; colour is only a
visual aid.

[Request or prioritize a capability](https://github.com/siraj-samsudeen/featherbase/issues/new?title=Capability%20request%3A%20&body=Capability%3A%0A%0AApplication%20or%20workflow%3A%0A%0AWhy%20the%20current%20capabilities%20are%20not%20enough%3A)
by describing the application and the repeated behavior an agent currently has
to build by hand. For an already tracked item, add the use case or a 👍 reaction
to its linked issue instead.

## Page intents

These five intents describe why a page exists. They are not five unrelated UI
systems.

### Workspace

A role-aware landing page composed from navigation, shortcuts, metrics, charts
and recent or important collections.

**Status: ◐ Partial.** Generic home pages and dashboards exist; applications
cannot yet declare their own workspace.

**Specification:** [Dashboards and Home Pages](../openspec/specs/dashboards-and-home-pages/spec.md) ·
**Tracking:** [application-owned pages #277](https://github.com/siraj-samsudeen/featherbase/issues/277)

### Collection

A searchable, filterable, sortable and pageable set of records, with saved
views, selection and actions.

**Status: ◐ Partial.** The generic Admin provides this behavior; the reusable
application page contract is not yet specified.

**Specifications:** [List View](../openspec/specs/list-view/spec.md) ·
[Saved Views](../openspec/specs/saved-views/spec.md)

### Record

One record viewed, created or edited through field groups, relations, child
rows, actions, history and attachments.

**Status: ◐ Partial.** Metadata-driven record editing exists; an application
cannot yet compose it as an owned page.

**Specifications:** [Row Editing](../openspec/specs/core-forms/spec.md) ·
[Tables and Fields](../openspec/specs/tables-and-fields/spec.md)

### Report

A parameterized query with typed results, totals, chart projection, saved
variants, export and drill-through.

**Status: ◐ Partial.** Query, script and summary reports exist; application
declaration and record drill-through remain incomplete.

**Specification:** [Reports and Charts](../openspec/specs/reports-and-charts/spec.md)

### Custom

A full React page for an exceptional workbench such as point of sale, bank
reconciliation or a domain visualizer.

**Status: ◐ Partial.** A trusted package can ship a whole custom client; a page
inside Featherbase's shared application shell is planned.

**Specification:** [Trusted Runtime Packages](../openspec/specs/trusted-runtime-packages/spec.md) ·
**Tracking:** [application-owned pages #277](https://github.com/siraj-samsudeen/featherbase/issues/277)

## Core blocks

Blocks compose standard pages. Input controls and visual variants remain
renderer choices inside these blocks rather than becoming new top-level ideas.

### Content

Markdown or safe rich content for lessons, instructions and static sections.

**Status: ◐ Partial.** Web Pages provide managed content, but a reusable Content
block has no accepted specification.

**Specification:** [Web Forms and Portal](../openspec/specs/web-forms-and-portal/spec.md)

### Collection block

Renders records as a table, compact list, cards, board, calendar or timeline
while retaining common query and action behavior.

**Status: ◐ Partial.** The projections exist in the generic Admin; the block and
its application declaration do not.

**Specifications:** [List View](../openspec/specs/list-view/spec.md) ·
[Board, Calendar and Timeline Views](../openspec/specs/board-calendar-and-timeline-views/spec.md)

### Field group

Displays or edits metadata-defined fields with responsive layout, validation,
dirty state and conflict handling.

**Status: ◐ Partial.** The generic form behavior exists; an application cannot
embed it as a declared block.

**Specification:** [Row Editing](../openspec/specs/core-forms/spec.md)

### Relation and child grid

Covers lookups, related collections and editable parent-child transaction rows.

**Status: ◐ Partial.** Relations and child records exist, but their reusable UI
block is not yet specified.

**Specification:** [Tables and Fields](../openspec/specs/tables-and-fields/spec.md)

### Action group

Presents record, selection, collection, navigation and workflow actions with
parameters, confirmation and result handling.

**Status: ◐ Partial.** Server actions and workflows exist; applications still
hand-build the controls that present them.

**Specifications:** [Workflow and Approvals](../openspec/specs/workflow-and-approvals/spec.md) ·
[Transactional Runtime Actions](../openspec/specs/transactional-runtime-actions/spec.md)

### Activity timeline

Shows comments, field changes, workflow transitions and command history as one
attributable sequence.

**Status: ◐ Partial.** Comments and changes exist; a unified embeddable timeline
is not yet specified.

**Specification:** [Comments and History](../openspec/specs/comments-and-history/spec.md)

### Attachments

Uploads, lists, previews, downloads and removes files under the current user's
authorization.

**Status: ◐ Partial.** File behavior exists, but applications lack a declared
Attachments block and the production storage contract remains open.

**Specification:** [Files and Sharing](../openspec/specs/files-and-sharing/spec.md) ·
**Tracking:** [production file storage #165](https://github.com/siraj-samsudeen/featherbase/issues/165)

### Metric

Shows a scalar result with an optional comparison, business status or trend.

**Status: ◐ Partial.** Number cards exist; the portable Metric block and its
comparison behavior are not yet specified.

**Specification:** [Dashboards and Home Pages](../openspec/specs/dashboards-and-home-pages/spec.md)

### Chart

Projects query or report results through a small supported set of chart
encodings.

**Status: ◐ Partial.** Report charts exist; an application cannot yet declare a
Chart block.

**Specification:** [Reports and Charts](../openspec/specs/reports-and-charts/spec.md)

### Custom block

A named React component with validated inputs and the same runtime services as
standard blocks.

**Status: ○ Not started.** Trusted packages can own a complete client, but no
custom component registration contract has been specified.

**Specification:** Not yet written.

## Runtime services

Shared services keep page and block declarations small. An application should
reuse these instead of implementing security, transactions and operational
behavior independently.

### Metadata and records

Schemas, validation, relations and child records.

**Status: ✓ Available.**

**Specification:** [Tables and Fields](../openspec/specs/tables-and-fields/spec.md)

### Authentication and permissions

Accounts, sessions, roles, and table-, row- and field-level authorization.

**Status: ✓ Available.**

**Specifications:** [Sign-in and Accounts](../openspec/specs/sign-in-and-accounts/spec.md) ·
[Permissions and Roles](../openspec/specs/permissions-and-roles/spec.md)

### Queries and saved views

Filtering, sorting, pagination, reusable views and relationship exploration.

**Status: ✓ Available.**

**Specifications:** [List View](../openspec/specs/list-view/spec.md) ·
[Saved Views](../openspec/specs/saved-views/spec.md) ·
[Search and Explore](../openspec/specs/search-and-explore/spec.md)

### Transactional actions

Permission-checked, transactional and idempotent custom server operations.

**Status: ✓ Available.**

**Specification:** [Transactional Runtime Actions](../openspec/specs/transactional-runtime-actions/spec.md)

### Workflow

States, transitions, approvals and assignment using Featherbase's existing
workflow engine.

**Status: ◐ Partial.** The engine is available; package-managed workflow
definitions and declarative action presentation are not.

**Specification:** [Workflow and Approvals](../openspec/specs/workflow-and-approvals/spec.md)

### Files

Authorized upload, download and attachment behavior with pluggable durable
storage.

**Status: ◐ Partial.** Core file operations exist; portable package integration
and production object storage are incomplete.

**Specification:** [Files and Sharing](../openspec/specs/files-and-sharing/spec.md) ·
**Tracking:** [production file storage #165](https://github.com/siraj-samsudeen/featherbase/issues/165)

### Audit, comments and engagement

Security history and collaboration events, plus opt-in visible-tab active-time
tracking for applications such as Training.

**Status: ◐ Partial.** Audit and comments exist; visible-tab active time and a
unified application timeline are not yet specified.

**Specification:** [Comments and History](../openspec/specs/comments-and-history/spec.md) ·
**Engagement specification:** Not yet written.

### Notifications and jobs

Email, webhooks, queued work, schedules, retries and application health.

**Status: ◐ Partial.** Platform services exist; app-owned jobs, health and
validated configuration do not yet have a complete portable contract.

**Specifications:** [Notifications, Email and Webhooks](../openspec/specs/notifications-email-and-webhooks/spec.md) ·
[Background and Scheduled Jobs](../openspec/specs/background-and-scheduled-jobs/spec.md) ·
**Tracking:** [package configuration and readiness #284](https://github.com/siraj-samsudeen/featherbase/issues/284)

### Import, export and print

Spreadsheet ingestion, tabular export and printable record or report views.

**Status: ◐ Partial.** These exist in the generic Admin; the package-facing
contracts are not yet unified.

**Specifications:** [Spreadsheet Import](../openspec/specs/spreadsheet-import/spec.md) ·
[Reports and Charts](../openspec/specs/reports-and-charts/spec.md) ·
[Printing](../openspec/specs/printing/spec.md)

## Packaging and escape hatches

Declarations are the durable default, not a restriction on trusted code.

### Runtime application package

Installs owned tables, migrations, actions, roles and a custom client as one
additively upgradeable unit.

**Status: ✓ Available.**

**Specification:** [Trusted Runtime Packages](../openspec/specs/trusted-runtime-packages/spec.md)

### Whole custom client

A package can ship an ordinary React application for behavior that does not fit
the standard page and block model.

**Status: ✓ Available.**

**Specification:** [Trusted Runtime Packages](../openspec/specs/trusted-runtime-packages/spec.md)

### Custom page in the shared shell

A package-owned React page that keeps Featherbase navigation, identity and
shared runtime services.

**Status: ◇ Planned.**

**Specification:** Not yet written. ·
**Tracking:** [application-owned pages #277](https://github.com/siraj-samsudeen/featherbase/issues/277)

### Namespaced server route

An authenticated package-owned HTTP endpoint for behavior that does not fit a
transactional action.

**Status: ◇ Planned.**

**Specification:** Not yet written. ·
**Tracking:** [application server routes #274](https://github.com/siraj-samsudeen/featherbase/issues/274)

### Application extraction and import

Moves one application's definitions, owned data, files and configuration
between a shared Featherbase installation and a dedicated installation.

**Status: ○ Not started.** Package ownership exists; the transfer contract does
not.

**Specification:** Not yet written.

## Deliberately deferred

The initial model does not include an arbitrary component-tree JSON language, a
drag-and-drop page builder, a visual workflow designer or an exhaustive widget
catalog. A new projection, renderer, block or service becomes framework
capability only after real applications prove that agents are repeatedly
rebuilding the same behavior.

## Keeping the status honest

- Available means reusable through the portable application contract, not only
  present somewhere in Featherbase's generic Admin.
- A capability implemented in one custom application remains app code until a
  reusable contract is specified and delivered.
- Accepted specifications define behavior. This page summarizes their
  application-facing availability; it does not replace them.
- Every status change should update this page in the same change that updates
  the accepted specification or tracking issue.
