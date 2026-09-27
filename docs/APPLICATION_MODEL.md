# Featherbase application model

Featherbase is an agent-first application framework. This page defines the
smallest reusable application vocabulary it intends to provide, and maps that
intent to what the platform already implements.

This is not a second behavior specification. Accepted behavior lives in
[`openspec/specs/`](../openspec/specs/), and executable evidence lives in the
test suites. An item may be called **available** here only when both are linked.
An intended item with no accepted contract is explicitly marked **not yet
specified** rather than being presented as a feature.

Every capability has two potentially different states:

- **Platform** — Featherbase's generic Admin can already do it.
- **Portable app contract** — an installed app can declare and reuse it without
  rebuilding the behavior in its own client.

The distinction matters. Featherbase already has a broad Frappe-style Admin,
but a runtime app such as Tasker still owns a complete React client and repeats
ordinary page wiring.

## The application grammar

The intended application grammar has five page intents, ten reusable blocks,
shared runtime services, and explicit full-code escape hatches. It deliberately
does not attempt to describe every possible React component in JSON.

### Page intents

#### Workspace

A module landing page composed from navigation, shortcuts, metrics, charts,
and recent or important collections.

- **Platform: available.** Home pages, dashboards, number cards, charts,
  role-aware links, recents, and activity are governed by
  [Dashboards and Home Pages](../openspec/specs/dashboards-and-home-pages/spec.md)
  and exercised by
  [`home-page.spec.ts`](../apps/web/e2e/home-page.spec.ts) and
  [`dashboard.spec.ts`](../apps/web/e2e/dashboard.spec.ts).
- **Portable app contract: missing.** Runtime apps cannot yet declare a
  workspace assembled from these primitives. App-owned React routes and
  navigation are tracked by
  [issue #277](https://github.com/siraj-samsudeen/featherbase/issues/277), but
  the declarative workspace contract is **not yet specified**.

#### Collection

A searchable, filterable, sortable and pageable set of records with saved
views, selection, row actions and bulk actions.

- **Platform: available.** See [List View](../openspec/specs/list-view/spec.md),
  [Saved Views](../openspec/specs/saved-views/spec.md), and
  [`listview.spec.ts`](../apps/web/e2e/listview.spec.ts).
- **Portable app contract: missing.** An app may call the generic APIs from
  custom React, but cannot declare a Collection page or block. This contract is
  **not yet specified**.

#### Record

One record viewed, created or edited through field groups, relations, child
rows, actions, history and attachments. Create and edit are modes of the same
record surface, not separate page systems.

- **Platform: available.** See [Row Editing](../openspec/specs/core-forms/spec.md),
  [Tables and Fields](../openspec/specs/tables-and-fields/spec.md),
  [`formview.spec.ts`](../apps/web/e2e/formview.spec.ts), and the child-row
  integration proof in [`children.test.ts`](../apps/server/test/children.test.ts).
- **Portable app contract: missing.** App-owned tables do not automatically
  become an app-owned declarative Record page. This contract is **not yet
  specified**.

#### Report

A parameterised query with typed tabular results, totals, chart projection,
saved variants, export and drill-through.

- **Platform: available.** Summary, query and script reports are governed by
  [Reports and Charts](../openspec/specs/reports-and-charts/spec.md) and proved
  through [`query-report.test.ts`](../apps/server/test/query-report.test.ts),
  [`report-view.spec.ts`](../apps/web/e2e/report-view.spec.ts), and
  [`report-export.spec.ts`](../apps/web/e2e/report-export.spec.ts).
- **Platform gap:** drill-through from a result to its underlying records is
  part of the intended Report page but is **not yet specified**.
- **Portable app contract: missing.** A package cannot yet declare an app-owned
  Report page over the existing engine. This contract is **not yet specified**.

#### Custom

A full React page for an exceptional workbench such as point of sale, bank
reconciliation, or a domain visualizer.

- **Platform: available at whole-app scope.** A trusted runtime package can
  ship its own client and open it inside the Featherbase host shell; see
  [Trusted Runtime Packages](../openspec/specs/trusted-runtime-packages/spec.md)
  and [`runtime-host-shell.spec.ts`](../apps/web/e2e/runtime-host-shell.spec.ts).
- **Portable app contract: partial.** The package must currently own the whole
  client. Registered pages inside the shared application shell are tracked by
  [issue #277](https://github.com/siraj-samsudeen/featherbase/issues/277).

## Core blocks

Blocks compose the standard pages. Input controls, table styles and other
visual variants are renderer choices inside these blocks, not additional
top-level concepts.

### Content

Markdown or safe rich content used for instructions, explanations and static
page sections.

- **Platform: partial.** Web Pages already provide a content surface under
  [Web Forms and Portal](../openspec/specs/web-forms-and-portal/spec.md), proved
  by [`web-page.spec.ts`](../apps/web/e2e/web-page.spec.ts).
- **Portable app contract: missing.** A reusable Content block is **not yet
  specified**.

### Collection

Renders a resource as a table, compact list or cards. Filtering, saved views,
selection and pagination belong to the block's behavior. Tree, kanban,
calendar and Gantt are projections of this block, not separate application
systems.

- **Platform: available.** In addition to the List View evidence above,
  alternate projections are governed by
  [Board, Calendar and Timeline Views](../openspec/specs/board-calendar-and-timeline-views/spec.md)
  and exercised by [`kanban.spec.ts`](../apps/web/e2e/kanban.spec.ts),
  [`calendar.spec.ts`](../apps/web/e2e/calendar.spec.ts), and
  [`gantt.spec.ts`](../apps/web/e2e/gantt.spec.ts).
- **Portable app contract: missing.** The block and its renderer selection are
  **not yet specified**.

### Field group

Displays or edits metadata-defined fields with responsive grouping, validation,
dirty state, conflicts, and server error mapping.

- **Platform: available.** The generic FormView implements the
  [Row Editing](../openspec/specs/core-forms/spec.md) contract; responsive field
  layout is exercised by
  [`grid-layout.spec.ts`](../apps/web/e2e/grid-layout.spec.ts).
- **Portable app contract: missing.** A package cannot embed this as a declared
  block. The block contract is **not yet specified**.

### Relation and child grid

Covers to-one lookup, related collections, and editable parent-child transaction
lines with inline and expanded editing.

- **Platform: partial.** Reference fields and nested-row viewing are covered by
  [Tables and Fields](../openspec/specs/tables-and-fields/spec.md) and
  [List View](../openspec/specs/list-view/spec.md). Editable child rows exist
  and are exercised by [`children.test.ts`](../apps/server/test/children.test.ts),
  but that behavior is not yet fully represented in the accepted specs.
- **Portable app contract: missing.** A relation/child-grid block is **not yet
  specified**.

### Action group

Presents page, record, selection, collection and navigation actions, including
workflow transitions, parameter collection, confirmation and result handling.

- **Platform: available in separate pieces.** Workflow transitions are governed
  by [Workflow and Approvals](../openspec/specs/workflow-and-approvals/spec.md).
  Package commands are governed by
  [Transactional Runtime Actions](../openspec/specs/transactional-runtime-actions/spec.md).
- **Portable app contract: partial.** Apps can declare and execute server
  actions, but custom clients hand-build their controls. One declarative action
  presentation contract is **not yet specified**.

### Activity timeline

Shows comments, field changes, workflow transitions and command history in one
attributable sequence.

- **Platform: partial.** Comments and field-change history are available under
  [Comments and History](../openspec/specs/comments-and-history/spec.md),
  [`timeline.spec.ts`](../apps/web/e2e/timeline.spec.ts), and
  [`activity-feed.test.ts`](../apps/server/test/activity-feed.test.ts).
  Workflow-transition and app-command events are part of the intended unified
  timeline but are **not yet specified** there.
- **Portable app contract: missing.** The timeline is not yet an embeddable
  declared block.

### Attachments

Uploads, lists, previews, downloads and removes files under the current user's
authorization.

- **Platform: available.** See
  [Files and Sharing](../openspec/specs/files-and-sharing/spec.md) and
  [`attachments.spec.ts`](../apps/web/e2e/attachments.spec.ts).
- **Portable app contract: partial.** Custom clients can use file endpoints,
  but packages have no declared Attachment block and runtime actions do not yet
  receive a complete app-facing file service. Durable production object storage
  is tracked by [issue #165](https://github.com/siraj-samsudeen/featherbase/issues/165).

### Metric

Shows a scalar result with optional comparison, status or trend.

- **Platform: partial.** Number cards are covered by
  [Dashboards and Home Pages](../openspec/specs/dashboards-and-home-pages/spec.md)
  and [`dashboard.test.ts`](../apps/server/test/dashboard.test.ts). Comparisons
  and trends in the intended Metric block are **not yet specified**.
- **Portable app contract: missing.** A Metric block is **not yet specified**.

### Chart

Projects query or report results through a small supported set of chart
encodings.

- **Platform: available.** See
  [Reports and Charts](../openspec/specs/reports-and-charts/spec.md) and
  [`report-chart.spec.ts`](../apps/web/e2e/report-chart.spec.ts).
- **Portable app contract: missing.** A Chart block is **not yet specified**.

### Custom block

A named React component with validated inputs and the same runtime services as
standard blocks.

- **Platform: missing.** Runtime packages can own a complete client, but cannot
  register a component into a declared page. App-owned React contributions are
  adjacent to [issue #277](https://github.com/siraj-samsudeen/featherbase/issues/277);
  the Custom block contract itself is **not yet specified**.

## Shared runtime services

Blocks stay small because they receive common behavior from the runtime rather
than rebuilding it.

### Already available to the platform

- **Metadata, relations, child records and validation:**
  [Tables and Fields](../openspec/specs/tables-and-fields/spec.md), with
  [`table-builder.spec.ts`](../apps/web/e2e/table-builder.spec.ts) and
  [`children.test.ts`](../apps/server/test/children.test.ts) as current evidence.
- **Authentication, roles, row and field permissions:**
  [Sign-in and Accounts](../openspec/specs/sign-in-and-accounts/spec.md) and
  [Permissions and Roles](../openspec/specs/permissions-and-roles/spec.md), with
  [`auth.test.ts`](../apps/server/test/auth.test.ts) and
  [`perms.test.ts`](../apps/server/test/perms.test.ts) as current evidence.
- **Queries, filters, saved views and relationship exploration:**
  [List View](../openspec/specs/list-view/spec.md),
  [Saved Views](../openspec/specs/saved-views/spec.md), and
  [Search and Explore](../openspec/specs/search-and-explore/spec.md), with
  [`filters.spec.ts`](../apps/web/e2e/filters.spec.ts),
  [`saved-views.spec.ts`](../apps/web/e2e/saved-views.spec.ts), and
  [`explore.spec.ts`](../apps/web/e2e/explore.spec.ts) as current evidence.
- **Workflow, audit, comments, files and notifications:**
  [Workflow and Approvals](../openspec/specs/workflow-and-approvals/spec.md),
  [Comments and History](../openspec/specs/comments-and-history/spec.md),
  [Files and Sharing](../openspec/specs/files-and-sharing/spec.md), and
  [Notifications, Email and Webhooks](../openspec/specs/notifications-email-and-webhooks/spec.md),
  with [`workflow.spec.ts`](../apps/web/e2e/workflow.spec.ts),
  [`timeline.spec.ts`](../apps/web/e2e/timeline.spec.ts),
  [`attachments.spec.ts`](../apps/web/e2e/attachments.spec.ts), and
  [`webhooks.test.ts`](../apps/server/test/webhooks.test.ts) as current evidence.
- **Background work:**
  [Background and Scheduled Jobs](../openspec/specs/background-and-scheduled-jobs/spec.md),
  with [`jobs.test.ts`](../apps/server/test/jobs.test.ts) and
  [`scheduled-jobs.test.ts`](../apps/server/test/scheduled-jobs.test.ts) as
  current evidence.
- **Import, export and print:**
  [Spreadsheet Import](../openspec/specs/spreadsheet-import/spec.md),
  [Reports and Charts](../openspec/specs/reports-and-charts/spec.md), and
  [Printing](../openspec/specs/printing/spec.md), with
  [`import-journey.spec.ts`](../apps/web/e2e/import-journey.spec.ts),
  [`report-export.spec.ts`](../apps/web/e2e/report-export.spec.ts), and
  [`print-view.spec.ts`](../apps/web/e2e/print-view.spec.ts) as current evidence.

### Portable app contracts that still need work

- **Declarative pages and blocks:** agreed here; **not yet specified**.
- **Package-managed workflow and other definition records:** the platform engine
  exists, but runtime-package JSON does not yet carry fixture/definition
  semantics; **not yet specified**.
- **App-owned jobs, lifecycle health and validated configuration:** platform
  services exist; the portable contract is incomplete. Configuration and
  readiness are tracked by
  [issue #284](https://github.com/siraj-samsudeen/featherbase/issues/284).
- **Namespaced authenticated server routes:** tracked by
  [issue #274](https://github.com/siraj-samsudeen/featherbase/issues/274).
- **Visible-tab active-time tracking:** required by the Training proving app;
  **not yet specified**. This is an opt-in engagement service, not the security
  audit log.
- **Application extraction and import:** app ownership and additive upgrades are
  covered by
  [Trusted Runtime Packages](../openspec/specs/trusted-runtime-packages/spec.md),
  but moving an app's owned data, files, configuration and dependencies between
  installations is **not yet specified**.

## Escape hatches

The durable declarations are the default, not a limit on trusted code.

- **Custom server operation: available.** Runtime actions are declared,
  permission-checked, transactional and idempotent under
  [Transactional Runtime Actions](../openspec/specs/transactional-runtime-actions/spec.md),
  with [`runtime-actions.test.ts`](../apps/server/test/runtime-actions.test.ts)
  and [`runtime-actions-commit.test.ts`](../apps/server/test/runtime-actions-commit.test.ts)
  as current evidence.
- **Whole custom client: available.** A runtime package may ship its own client
  under [Trusted Runtime Packages](../openspec/specs/trusted-runtime-packages/spec.md),
  proved through
  [`runtime-host-shell.spec.ts`](../apps/web/e2e/runtime-host-shell.spec.ts).
- **Custom React page inside the shared shell: planned.** See
  [issue #277](https://github.com/siraj-samsudeen/featherbase/issues/277).
- **Namespaced server route: planned.** See
  [issue #274](https://github.com/siraj-samsudeen/featherbase/issues/274).
- **Custom block: intended.** **Not yet specified.**

## Deliberately deferred

The minimum does not include an arbitrary component-tree page language, a
drag-and-drop human page builder, a visual workflow designer, or a catalog of
every possible widget. New Collection projections, field renderers and blocks
should be added when real applications prove repeated behavioral wiring—not
merely because two screens look similar.

## Keeping this page honest

- An intended capability is promoted to **available** only in the same change
  that adds or updates its accepted OpenSpec contract and executable evidence.
- A feature implemented only inside one custom application remains app code; it
  does not become a Featherbase capability until the reusable contract exists.
- Specs define behavior, tests provide current evidence, and this page explains
  how those capabilities fit the application model. If they disagree, the spec
  and implementation must be reconciled rather than silently changing this
  summary.
