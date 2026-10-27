## Why

Who may do what was protected only by the absence of a Permission row: a role
granted write on Person could change roles and the enabled flag, and a grant on
Permission, Role or Data Scope would have handed out every other grant. Before
go-live, changes to access must always need a System Manager, whatever the
Permission rows say, and a release must refuse to ship with an open
configuration (#437).

## What Changes

- A hard, code-level refusal for anyone but a System Manager (or
  Administrator) writing the access-control Tables — Permission, Role, Has
  Role, Data Scope, Share, Sign In Method, Identifier System, Installed App —
  and the Tables that decide Sales Target scope (Sales Target Assignment,
  Employee Section Map, Section Ownership, Store Manager, Section Merchandise
  Map, Section Name Alias) and the tables that act on others' rows (Server
  Script, Workflow, Assignment Rule). Every public write path: save, import, delete,
  rename, submit/cancel/amend, Settings save, workflow actions. Reads stay
  governed by ordinary grants.
- A Person's roles and enabled flag change only for a System Manager, through
  any save path, including a write-share. Unchanged values still ride along on
  an ordinary edit. The check runs on the row as written, after every save
  hook and Document Event script. A Workflow or Assignment Rule may not target
  an access column or a security table, at save time or when it acts.
- Release preflight refuses (a) a Permission row giving All or Guest anything
  on Person or those Tables (in `featherbase` or, before the schema move,
  `public`), (b) any sign-in method with `new_person = create` outside
  development or test — it ignores the domain list, (c) a method that creates people admitting `*`
  or a consumer email domain.
- Tasker 2.3.0 no longer grants everyone read on Person; an upgrade may now
  withdraw grants its predecessor declared (never add or widen one), logged
  to the activity log. The image and `init.sh` ship the 2.2.0 predecessor
  (`runtime-apps/fixtures/tasker-v2.2`) so installs on 2.2.0 can upgrade.

## Capabilities

### Modified Capabilities

- `permissions-and-roles`: access-control Tables and a Person's access columns
  are System Manager only; the release refuses an open access configuration.
- `trusted-runtime-packages`: an upgrade may withdraw an access rule.

## Impact

`apps/server/src/security-tables.ts` (new), `document.ts`, `workflow.ts`,
`release-preflight.ts`, `runtime-packages.ts`; `runtime-apps/tasker`. Sibling
of #432's system-written guard (PR #441), called from the same entry points.
