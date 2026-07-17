# PR 1 vs PR 2 — comparison verdict (2026-07-17)

Two parallel implementations of the same Frappe-clone prompt were evaluated
hands-on: each was booted and driven over real HTTP against a 16-point
"could this host a metadata-only ticketing system?" checklist (runtime
DocType creation, naming series, child tables, workflow, DocPerm/if_owner/
User Permissions, assignments, notifications, comments, portal, jobs, server
scripts, views, attachments, realtime).

- **PR 1** — `claude/frappe-framework-replication-oizyrh` (merged to main):
  Hono + generated DDL per DocType, 126/126 harness features claimed.
- **PR 2** — `claude/frappe-framework-replication-z0ggcy` (open):
  NestJS/Fastify + Drizzle, single JSONB `documents` table, 24/57 of its own
  feature list passing by its own contract.

## Verdict: keep PR 1

PR 1 passed essentially the whole checklist live: the audit created a Ticket
DocType at runtime with zero code and immediately had a naming series
(41 concurrent creates, no gaps), atomic child tables, a role-gated
server-enforced workflow, deny-by-default DocPerms with if_owner scoping,
assignments with notifications, comments/timeline, attachments with signed
URLs, web form + portal, background jobs, runtime Server Scripts in a
hardened sandbox, and Kanban/report views. Its 126/126 claim held up for
everything exercised (~40 features' worth), with the caveat that "passing"
means "passes its stated check", not full Frappe parity. 308 real HTTP-level
tests were green; queries are injection-safe.

PR 2 has a genuinely solid, honestly-reported core — runtime DocTypes, naming
series, role/DocPerm enforcement, and a polished generic Desk (its
list/report/kanban screenshots are the nicest part) — but **every
ticketing-defining feature is missing by its own admission**: no workflow
engine, no assignments, no email/notifications, no comments, no attachments,
no web forms/portal, no realtime, no runtime server scripts, and no reports
backend. It also had a correctness defect (every document's `owner` is
hard-coded to `Administrator`, breaking if_owner portals), no Link/reqd
enforcement, and an unindexed JSONB store that would wall at volume.
Its honest self-assessment deserves credit, but it is roughly a third of a
ticketing MVP where PR 1 is ~85% of one.

## Gaps found in BOTH (called out, per the evaluation brief)

1. **Assignment Rules** (auto/round-robin assignment) — in neither backlog.
2. **SLAs** (response/resolution deadlines + escalation) — in neither backlog.
3. **Workflow bound to a real field** (Frappe's `workflow_state_field`) —
   PR 1 forced a parallel `workflow_state` field; PR 2 has no workflow at all.
4. **Inbound email → ticket** (IMAP/communication threading) — in neither
   backlog; both cover outbound only (PR 1) or nothing (PR 2). Still open.
5. Dynamic notification recipients, portal owner attribution for web-form
   submissions, and firing email rules on create/save — present-but-broken
   or absent in PR 1, absent in PR 2.

## What was then built on PR 1 (this branch)

To prove the choice concretely, the framework gaps were filled and a complete
Helpdesk was built **from metadata only** (see `apps/server/scripts/
seed-helpdesk.ts` — pure HTTP, no framework code, no frontend code):

- Framework: Assignment Rules engine, SLA engine + `check_sla` escalation
  job, workflow `state_field` binding with save-protection, email rules on
  `on_create`/`on_save` (+ transition-only conditions, templated recipients,
  and firing on workflow transitions), session-aware web-form owner
  attribution, and the user-permission NULL-link list fix.
- App: Ticket DocType (TICK-.##### series), three roles, Open → In Progress
  → Resolved → Closed workflow on the `status` field (Close is manager-only,
  Resolve requires resolution details, customers may Reopen), round-robin
  auto-assignment stamping `agent`, per-priority SLA with Overdue escalation
  emails, resolved-notification email to the requester, public intake form,
  and an if_owner customer portal.
- Verified end-to-end by `pnpm --filter server verify:helpdesk` (32 checks,
  all passing) plus 324 green server tests.

Recommendation: close PR 2 without merging. Its two genuinely nice ideas —
the frappe-ui-style Desk polish and the honest default-FAIL grading contract —
are worth cherry-picking as inspiration, not code.
