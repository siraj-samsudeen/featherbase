# Frappe Framework Architecture Study

> **Provenance:** research agent report, 2026-07-08, from a study of a fresh shallow clone of frappe/frappe (v17.0.0-dev, develop branch). `$REPO` refers to the reference clone kept at `NonDropBoxProjects/frappe_clone/frappe`. Preserved verbatim; the original goal framing ("we plan to fork it") predates the decision to rewrite in JS — the architecture map and gap analysis remain the canonical reference for which Frappe concepts Featherbase re-creates.

---

# Frappe Framework (v17.0.0-dev, develop branch) — Architecture Map & Glide-Style Workflow Gap Analysis

All paths below are under `$REPO = /Users/siraj/Desktop/NonDropBoxProjects/frappe_clone/frappe`.

---

## 1. Core Architecture Map

### 1.1 DocType metadata system (schema + UI as data)

- **DocType controller**: `$REPO/frappe/core/doctype/doctype/doctype.py` — a DocType is itself a document; `on_update` syncs the DB table, validates fields (incl. `validate_fetch_from`, `validate_virtual_doctype_methods`), builds global search config.
- **Field definitions**: `$REPO/frappe/core/doctype/docfield/docfield.json` — each field carries schema (`fieldtype`, `options`) _and_ UI metadata (`depends_on`, `read_only_depends_on`, `mandatory_depends_on`, `in_list_view`, `fetch_from`, `is_virtual`, `default`). Schema and UI are one artifact.
- **Meta loading**: `$REPO/frappe/model/meta.py` — `frappe.get_meta(doctype)` returns cached, processed metadata (fields, permissions, table fields, workflow state field via `get_workflow_name`).
- **Customization without forking doctypes**: `$REPO/frappe/custom/doctype/custom_field/`, `property_setter/`, `customize_form/` — layered overrides stored as data. The Workflow engine itself uses this (auto-creates a hidden Custom Field for the state, `workflow.py:create_custom_field_for_workflow_state`).
- **Sync**: `$REPO/frappe/model/sync.py` — doctype JSON files on disk ⇄ DB on migrate; this is how an app ships doctypes.

### 1.2 Document ORM

- `$REPO/frappe/model/document.py` + `base_document.py` — `Document` lifecycle: `insert → before_validate → validate → before_save → (db write) → on_update → on_change`; submittable docs add `before_submit/on_submit`, `before_cancel/on_cancel`, `on_update_after_submit`; plus rename/trash/discard events. `docstatus` (0 draft / 1 submitted / 2 cancelled, `$REPO/frappe/model/docstatus.py`).
- **`run_method` is the universal event bus** (`document.py:1638`): every lifecycle method runs → (a) the controller method, (b) all `doc_events` hooks from every installed app (`Document.hook` composer at `document.py:2005-2055`, resolved via `frappe.get_doc_hooks()` in `$REPO/frappe/__init__.py:985`), then (c) `run_notifications` (Notification doctype), (d) `run_webhooks` (Webhook doctype), (e) `run_server_script_for_doc_event` (Server Script doctype). **This one function is the natural attach point for any new trigger engine.**
- Query layer: `$REPO/frappe/model/db_query.py` (list queries with permission filtering), `$REPO/frappe/query_builder/` (pypika-based).

### 1.3 Hooks system

- Per-app `hooks.py` (frappe's own: `$REPO/frappe/hooks.py`) aggregated across installed apps by `frappe.get_hooks()` (`$REPO/frappe/__init__.py:1035`, `_load_app_hooks`).
- Key hook families: `doc_events` (doctype → event → dotted handler paths, `"*"` wildcard supported), `scheduler_events` (`cron`/`all`/`hourly`/`daily`/...), `override_whitelisted_methods`, `permission_query_conditions`, `has_permission`, `before_request/after_request`, `before_job/after_job`, `extend_bootinfo`, and (new in v17) **`workflow_methods`** — app-registered named tasks selectable in workflow transitions.
- Frappe wires its own automations through wildcard doc_events (`$REPO/frappe/hooks.py:163-212`): workflow action processing, assignment rules, milestone tracking all listen on `"*"`.

### 1.4 Permission model

- `$REPO/frappe/permissions.py` — 14 rights (`select, read, write, create, delete, submit, cancel, amend, print, email, report, import, export, share`).
- Layers: **Role permissions** (DocPerm rows in the doctype JSON / Custom DocPerm, with `permlevel` for field-level), **`if_owner`** (row-level "own documents only", `get_doc_permissions:254-268`), **User Permissions** (`$REPO/frappe/core/doctype/user_permission/` — restrict a user to specific link values, applied as filters in `db_query.py`), **DocShare** (`$REPO/frappe/share.py`, per-document grants), plus programmable `permission_query_conditions` / `has_permission` hooks and **Permission Query Server Scripts** (row-level SQL conditions written in the UI).
- Enforced both per-document (`has_permission`) and in list queries (`db_query.py`).

### 1.5 REST API

- `$REPO/frappe/api/__init__.py` — versioned werkzeug URL map. **v1** (`v1.py`): `/api/resource/{doctype}[/{name}]` CRUD + `/api/method/{dotted.path}` RPC to `@frappe.whitelist()` functions. **v2** (`v2.py`): `/api/v2/document/{doctype}[/{name}]`, doc method execution, bulk update/delete, `/api/v2/meta/{doctype}`, and `/api/v2/discovery` (API discovery). Auth: session, API key/secret, OAuth2 (`$REPO/frappe/oauth.py`, `integrations/doctype/oauth_*`).
- Realtime push to clients: `$REPO/frappe/realtime/__init__.py` (`publish_realtime`, `publish_progress`) → Node socket.io server (`$REPO/realtime/`, `socketio.js`); `doc.notify_update()` pushes doc refresh events.

---

## 2. Existing Workflow + Automation Inventory

### 2.1 Workflow module (state machine for approvals)

- **Engine**: `$REPO/frappe/model/workflow.py`. One active Workflow per doctype (`get_workflow_name`, cached). States live in a (custom) Link field on the target doctype pointing to Workflow State.
- **Doctypes** (`$REPO/frappe/workflow/doctype/`):
  - `workflow/` — parent: `document_type`, `is_active`, `send_email_alert`, `workflow_state_field`, `states[]`, `transitions[]`, and **`workflow_data` (JSON)** — persisted node/edge canvas positions for the visual builder.
  - `workflow_document_state/` (child "states") — `state`, `doc_status`, `allow_edit` (role that may edit in this state), `update_field`/`update_value` (+`evaluate_as_expression`), `is_optional_state`, `send_email`, `next_action_email_template`, `workflow_builder_id`.
  - `workflow_transition/` (child) — `state → action → next_state`, `allowed` (role), `allow_self_approval`, `condition` (safe-eval'd Python against `doc` + a tiny whitelist: `get_workflow_safe_globals` gives only `frappe.db.get_value/get_list`, session, date utils), `send_email_to_creator`, **`transition_tasks`** (link to Workflow Action Master task list).
  - `workflow_state/`, `workflow_action_master/` — masters (state names/styles; action names).
  - **New in v17**: `workflow_transition_task/` + `workflow_transition_tasks/` — per-transition task lists. `apply_workflow` (`workflow.py:152-203`) executes tasks **sync (same transaction) or async (`frappe.enqueue`)**; built-in task types are `Webhook` and `Server Script` (`DEFAULT_WORKFLOW_TASKS`), plus any app-defined `workflow_methods` hook entries. This is a nascent trigger-action seed already in core.
  - `workflow_action/` — the approval inbox: on every `on_update/on_cancel/on_trash` of any doc (`hooks.py` wildcard → `process_workflow_actions`), Workflow Action rows are created per permitted role for the next possible transitions, emails with **guest-accessible approve/reject links** are sent (`apply_action` is `@frappe.whitelist(allow_guest=True)`), and completed/stale actions are updated.
- **State machine semantics**: `get_transitions` filters by current state + user roles + condition; `apply_workflow` sets the state field, applies `update_field`, runs transition tasks, then saves/submits/cancels per target `doc_status`; `validate_workflow` blocks illegal state jumps on ordinary saves. Bulk approval supported (`bulk_workflow_approval`, ≤500 docs).
- **Visual builder — YES, one exists**: Desk page `workflow-builder` (`$REPO/frappe/workflow/page/workflow_builder/workflow_builder.js`) lazily loads a **Vue 3 + Pinia + @vue-flow** canvas app (`$REPO/frappe/public/js/workflow_builder/` — `WorkflowBuilder.vue`, `store.js`, `components/{StateNode,ActionNode,TransitionEdge,ConnectionLine,Properties,Sidebar}.vue`). It edits states/transitions as draggable nodes/edges, persisting layout into `Workflow.workflow_data`. Still flagged **"Beta"** in the UI.
- **Limitations**: one workflow per doctype; states must map onto the 3-value docstatus model; triggers only fire on _manual human transition actions_ (not on arbitrary field changes, schedules, or external events); no branching/parallel approval paths, no multi-step sequential logic beyond the linear state graph, no per-transition wait/delay, conditions are single Python expressions (no visual condition builder), transition tasks have no ordering UI/retry/error surface beyond logs, and the builder edits only the state machine — not the tasks/automation side.

### 2.2 Automation module (`$REPO/frappe/automation/doctype/`)

- **Assignment Rule** (`assignment_rule/`) — auto-assign docs (ToDo-based) via `assign_condition`/`unassign_condition`/`close_condition` (Python), strategies: Round Robin, Load Balancing, Based on Field, Weighted Distribution; due-date field mapping; runs on wildcard `on_update`/`on_cancel` doc_events.
- **Auto Repeat** (`auto_repeat/`) — recurring document creation from a reference doc (frequency incl. day-of-month rules, end date, optional auto-submit, notification email); driven by daily scheduler (`make_auto_repeat_entry`).
- **Milestone / Milestone Tracker** (`milestone_tracker/`) — logs a Milestone row whenever a tracked field changes (`on_change` wildcard hook).
- **Reminder** (`reminder/`) — user reminders, 15-min scheduler.

### 2.3 Server Script / Client Script

- **Server Script** (`$REPO/frappe/core/doctype/server_script/server_script.py`) — script types: `DocType Event`, `Scheduler Event` (auto-creates a Scheduled Job Type, incl. cron), `Permission Query`, `API` (custom REST endpoint with rate limiting/guest option), and **`Workflow Task`** (new). DocType events cover 24 hooks (`server_script_utils.py:EVENT_MAP` — before/after insert/save/submit/cancel/delete/rename/discard, update-after-submit, before_print, payment events). Dispatched from `run_method` via a cached `server_script_map`.
- **Sandboxing — yes, RestrictedPython**: `$REPO/frappe/utils/safe_exec.py` — `compile_restricted` with a custom `FrappeTransformer` policy, guarded getattr/iteration, and a large curated `get_safe_globals()` (whitelisted `frappe.*` API, no imports, no dunder access); `restrict_commit_rollback=True` for doc events. Site must opt in (`is_safe_exec_enabled`, `server_script_enabled` in site config). Same sandbox powers workflow/webhook/notification conditions (`frappe.safe_eval`) and **virtual field expressions**.
- **Client Script** (`$REPO/frappe/custom/doctype/client_script/`) — per-doctype JS injected into Form or List view; no sandbox (runs in browser as the user).

### 2.4 Notification doctype (`$REPO/frappe/email/doctype/notification/notification.py`)

- Events: `New, Save, Submit, Cancel, Value Change, Method (custom doc event), Days Before/After, Minutes Before/After` (date-based ones run via 5-min offset and daily scheduler jobs).
- Conditions: Python (`safe_eval`) **or declarative Filters** (`condition_type`, `evaluate_filters`) — a precedent for no-code conditions.
- Channels: Email, Slack (incoming webhook), System Notification (in-app), SMS; Jinja-templated subject/message, print-format attachments, recipients by field/role/assignees; **`set_property_after_alert`** — can write a field value back after firing (a mini "action").
- Dispatched from `Document.run_notifications` inside `run_method`.

### 2.5 Webhook doctype (`$REPO/frappe/integrations/doctype/webhook/`)

- Outgoing HTTP on doc events: `after_insert, on_update, on_submit, on_cancel, on_trash, on_update_after_submit, on_change`, plus **`workflow_transition`** (as a workflow transition task). Python condition, key-value or Jinja-JSON body, Jinja dynamic URL, custom headers, HMAC-SHA256 signature header, per-webhook RQ queue, 3 retries, `Webhook Request Log`. Deduplication: only the last state of a doc per request is sent (`__init__.py`).

### 2.6 Scheduling / background jobs

- **RQ (Redis Queue)** workers: `$REPO/frappe/utils/background_jobs.py` — `frappe.enqueue`/`enqueue_doc`, named queues (short/default/long + custom), `enqueue_after_commit`, dedup via `job_id`, worker pools.
- **Scheduler**: `$REPO/frappe/utils/scheduler.py` tick loop → enqueues all due `Scheduled Job Type` docs (`$REPO/frappe/core/doctype/scheduled_job_type/`), which are synced from every app's `scheduler_events` hook + Server Scripts. Cron supported. Execution logged in Scheduled Job Log.

---

## 3. UI Stack

- **Desk (main app)**: legacy-but-solid **jQuery + Bootstrap 4 class-based JS** (`$REPO/frappe/public/js/frappe/`), built with a custom **esbuild** pipeline (`$REPO/esbuild/esbuild.js`, `*.bundle.js` entry convention, `esbuild-plugin-vue3` for embedded Vue). **Vue 3 + Pinia is the established pattern for all new builder UIs**, mounted inside Desk pages.
- **Views**: Form (`views/formview.js` + `form/`), List, Report (frappe-datatable), **Kanban** (`$REPO/frappe/public/js/frappe/views/kanban/` + `Kanban Board` doctype with drag-drop column = field value), Calendar (FullCalendar), Gantt (frappe-gantt), Tree, Map, Image, Dashboard (frappe-charts, Number Card).
- **Existing drag-drop builders in-repo** (all Vue 3 + Pinia):
  - **Form Builder** — `$REPO/frappe/public/js/form_builder/` (drag-drop DocType field/layout editing; also used by Customize Form and Web Form).
  - **Workflow Builder** — `$REPO/frappe/public/js/workflow_builder/` (**@vue-flow node/edge canvas** — the exact widget class a Glide-style automation canvas needs; `@vue-flow/core` + `@vue-flow/background` already in `$REPO/package.json`).
  - **Layout Builder** — `$REPO/frappe/public/js/layout_builder/`; **Print Format Builder** — `print_format_builder/`.
- **Web Forms**: `$REPO/frappe/website/doctype/web_form/` — public/portal forms over doctypes, with the form-builder editing experience.
- **Customize Form**: `$REPO/frappe/custom/doctype/customize_form/` — per-site field/property overrides without touching app code.
- **Emerging new UI layer**: `$REPO/ui/` — `@framework/ui`, a **Vue 3 + TypeScript + Vite shared component library** (FormLayout, ListView, Filter, SortBy, ColumnSettings…), extracted from Frappe CRM; plus `app_home = "/app/build"` and `/desk/*` routing in hooks — v17 is mid-transition toward an SPA-style desk. A fork adding big new UI surface should watch/lean on this.

---

## 4. Data-Layer Features vs Glide

| Glide concept                   | Frappe equivalent                                                                                                                                                                           | Notes                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables/columns                  | DocType/DocField                                                                                                                                                                            | Richer: 40+ fieldtypes, child tables, submittable docs                                                                                                                |
| Relations                       | `Link`, `Dynamic Link`, `Table`, `Table MultiSelect` fields                                                                                                                                 | First-class, with integrity checks                                                                                                                                    |
| Lookup columns                  | **`fetch_from`** (`base_document.py:1085-1170`)                                                                                                                                             | Copies value from linked doc **at save time** (denormalized; `fetch_if_empty` optional). Not live like Glide lookups                                                  |
| Computed/formula columns        | **Virtual DocFields** (`is_virtual` + Python expression in `options`, evaluated via `safe_eval` with safe globals + `doc`; or a `@property` on the controller) — `base_document.py:539-555` | Computed on read, not stored, not filterable/sortable in SQL queries. Expression is Python, not a spreadsheet formula language; no dependency graph/recalc            |
| Rollups                         | **None built-in**                                                                                                                                                                           | Done manually via controller code, Server Scripts, or virtual fields calling `frappe.db.get_value`; no declarative aggregate-over-children/links column               |
| External data sources           | **Virtual DocTypes** (`$REPO/frappe/model/virtual_doctype.py`)                                                                                                                              | Full protocol (`get_list/get_count/db_insert/load_from_db/db_update/delete`) to back a doctype with any external store/API — ideal for Glide-style "connected sheets" |
| Client-side computed visibility | `depends_on` / `read_only_depends_on` / `mandatory_depends_on` JS-ish expressions                                                                                                           | Evaluated in the browser form                                                                                                                                         |

**Gap summary (data layer)**: no formula language, no live lookups, no rollups, no automatic recalculation graph. `fetch_from` + virtual fields + Virtual DocTypes are the raw ingredients; a Glide-like experience would need a declarative formula/rollup field type with server-side evaluation and invalidation.

---

## 5. Gap Analysis vs a Glide-Style Visual Trigger-Action Builder

**What frappe already has (surprisingly much):**

1. **Every trigger primitive exists**: doc lifecycle events (`run_method` fan-out), value-change detection (`on_change` + `doc_before_save`, used by Milestone/Notification "Value Change"), date-relative triggers (Notification Days/Minutes Before/After), cron/schedules (Scheduled Job Type), inbound API/webhook receivers (whitelisted methods / API Server Scripts), manual approval actions (Workflow), payment events.
2. **Every action primitive exists**: send email/Slack/SMS/in-app (Notification), call HTTP (Webhook), run sandboxed code (Server Script), create documents on schedule (Auto Repeat), assign users (Assignment Rule), set field (`set_property_after_alert`, workflow `update_field`), enqueue background jobs, realtime UI push.
3. **A visual canvas** (workflow builder, @vue-flow) and **the transition-task mechanism** (v17) that already chains Webhook/Server Script actions to a trigger.

**What's missing for Glide-style automations:**

1. **No unified "Automation" object.** Triggers and actions are scattered across five doctypes (Notification, Webhook, Server Script, Assignment Rule, Workflow) each with its own condition syntax, UI, and logs. There is no doctype that says "WHEN X happens IF C THEN do A1, A2, A3."
2. **No multi-step sequences** — no ordered action lists (outside workflow transition tasks), no data piping between steps, no branching (if/else), no loops over child rows, no delays/waits ("wait 3 days then…"), no human-in-the-loop step inside an automation (that's only in Workflow).
3. **No visual editor for triggers/actions** — the workflow builder draws only approval state machines; Notifications/Webhooks/Server Scripts are plain forms with Python condition strings.
4. **No unified run history** — logs are fragmented (Webhook Request Log, Scheduled Job Log, Error Log, Email Queue); no per-automation execution timeline with step status/retry/replay.
5. **Conditions are code-first** — Python `safe_eval` strings everywhere; only Notification has a declarative Filters alternative. A no-code condition builder (field/operator/value rows → `evaluate_filters`) is needed.
6. **No templated variable picker** — Jinja is available but there's no UI for inserting `{{ doc.field }}` tokens from a schema-aware picker.
7. **Data layer**: no formulas/rollups (Section 4).

---

## 6. Where New Code Would Live (Integration Points)

> _Note: this section answered the original "fork frappe" question, which was later superseded by the JS-rewrite decision (see ADR 0001). Kept for the record — its analysis of frappe's extension points informed the Featherbase event-bus and hooks design._

**Recommended shape: a new module inside the fork's frappe core, OR a separate frappe app.** Trade-off:

- _Separate app_ (scaffolded by `bench new-app` → `$REPO/frappe/utils/boilerplate.py`: `hooks.py`, `modules.txt`, `<app>/<module>/doctype/…`, `public/js`) keeps the fork rebaseable against upstream frappe — strongly preferable if you intend to track upstream (v17 is a fast-moving develop branch mid-UI-transition). Everything needed (doc_events `"*"` hooks, scheduler_events, pages, bundles) is available to any app; frappe's own automation module uses no private APIs.
- _In-core module_ (add `Visual Automation` to `$REPO/frappe/modules.txt`, create `$REPO/frappe/visual_automation/`) only buys you the ability to modify `run_method` itself — which you don't need, and it makes upstream merges painful. Only fork core if you also plan to add formula/rollup fields (those _do_ require touching `base_document.py`/`meta.py`/`db_query.py`).

**Concrete slots for a trigger-action engine:**

1. **Trigger subscription** — register a wildcard hook in your app's `hooks.py`, mirroring `$REPO/frappe/hooks.py:163`:
   `doc_events = {"*": {"after_insert": "...", "on_update": "...", "on_change": "...", "on_submit": ...}}` — this rides `Document.run_method`, sees `doc._doc_before_save` for field-change detection, and runs in-transaction. Enqueue actual action execution via `frappe.enqueue(..., enqueue_after_commit=True)` (pattern: webhook `__init__.py` and workflow async tasks).
2. **Scheduled triggers** — create `Scheduled Job Type` docs programmatically (pattern: `ServerScript.sync_scheduled_job_type`, `$REPO/frappe/core/doctype/server_script/server_script.py:121`) or use `scheduler_events` hooks.
3. **Inbound-event triggers** — `@frappe.whitelist(allow_guest=True)` endpoints (pattern: `workflow_action.apply_action`) or API-type Server Scripts.
4. **New doctypes** — e.g. `Automation` (parent: trigger doctype/event/filters), `Automation Step` (child: ordered actions), `Automation Run` + `Automation Run Step` (execution log; register in `default_log_clearing_doctypes`). Reuse: `evaluate_filters` (`$REPO/frappe/utils/data.py`) for no-code conditions, `frappe.safe_eval`/`safe_exec` for escape-hatch code steps, `enqueue_webhook`, Notification's send machinery, `assign_to` (`$REPO/frappe/desk/form/assign_to.py`).
5. **Visual editor** — a Desk Page + lazy-loaded Vue bundle, copying the workflow-builder pattern exactly: page def like `$REPO/frappe/workflow/page/workflow_builder/` (loads via `frappe.require("<name>.bundle.js")`), Vue 3 + Pinia + **@vue-flow** app like `$REPO/frappe/public/js/workflow_builder/`, canvas layout persisted in a JSON field on the parent doctype (pattern: `Workflow.workflow_data`). All build tooling (esbuild + Vue plugin) already handles `*.bundle.js` in any app's `public/js`.
6. **Extensibility** — expose your own hook (pattern: `workflow_methods` in `$REPO/frappe/model/workflow.py:170` and `get_workflow_methods` whitelisted endpoint) so other apps can register named action types that appear in the visual builder.

**Key files to study first when implementing** (highest signal): `$REPO/frappe/model/document.py` (run_method/hook composer), `$REPO/frappe/model/workflow.py` (apply_workflow + transition tasks), `$REPO/frappe/public/js/workflow_builder/store.js` + `utils.js` (canvas ⇄ doctype serialization), `$REPO/frappe/utils/safe_exec.py` (sandbox), `$REPO/frappe/email/doctype/notification/notification.py` (condition_type Filters precedent), `$REPO/frappe/integrations/doctype/webhook/__init__.py` (event fan-out + dedup + queueing).

---

## Addendum (verified 2026-07-08, during the storage-design discussion)

Frappe creates a **real MariaDB table per DocType** — including user-created custom DocTypes at runtime: `DocType.on_update` (`doctype.py:540`) → `frappe.db.updatedb` → `MariaDBTable.create()` (`database/mariadb/schema.py`) runs `CREATE TABLE tab<Name>` with real columns and real indexes; custom fields become `ALTER TABLE ADD COLUMN`. The EAV-ish exception is Single DocTypes, stored as key-value rows in `tabSingles` (`database/database.py:728`). This symmetry (developer-defined and user-created tables get identical physical treatment) is preserved in Featherbase via ADR 0002.
