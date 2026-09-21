# Feature: Trusted runtime packages

**IDs:** `PKG-J*` journeys · `PKG-R*` rules · `PKG-H*` hazards.
**Provenance:** issue #296; first build-and-learn slice, not a public plugin API.

## Prior state and job

An operator has a built Featherbase server/client and two separately built,
trusted npm-compatible package directories. A signed-in team member wants to
open Tasker and use the task journeys in spec 0010 without a new Featherbase
build. Existing local Team Task/Team Project rows must survive the transition.

## PKG-J1 — Install and use an independently delivered app

> evidence: gap #296 — runtime package implementation and browser proof pending.

| Where / do | Must see | Bug if |
|---|---|---|
| Build Featherbase, then build/stage Tasker and Other separately; configure paths and restart | Both packages available for installation | Core rebuild or Tasker import required |
| Manager installs both; ordinary member opens app catalog | Accessible enabled apps, with Tasker launch link | Catalog requires System Manager or exposes inaccessible apps |
| Open Tasker; capture and assign work; complete and undo | Full-stage app, task rules preserved, undo restores In progress | Core shell owns Tasker layout or rule disappears |
| Open a missing Tasker asset | Not found | Tasker or core index returned |

Isolation: disposable local database, built core held unchanged during staging.
Desktop and phone screenshots are inspected, not merely captured.

## PKG-J2 — Suspend an app without losing work

> evidence: gap #296 — lifecycle and restart proof pending.

| Where / do | Must see | Bug if |
|---|---|---|
| Manager disables Tasker; old browser submits another edit | Launch disappears and stale request is rejected | Hook-free writes succeed |
| Open Other's Task with the same row ID | Other's distinct columns, value, permissions and rule still apply | Resolution crosses apps by local name |
| Restart, enable Tasker, reopen work | Original rows/grants, one execution of each hook | Reinstallation, data loss or duplicate hooks |
| Restart without Tasker's package, or with incompatible code | Installed but unavailable, with writes denied | Silent activation without rules |

Isolation: two packages declare visible Task, with asymmetric schema, values,
rules and ordinary-user grants; reference targets are explicit identities.

## PKG-R1 — Versioned trusted artifact contract

> evidence: gap #296 — loader tests pending.

A package directory carries package.json and a declarative Featherbase manifest
with exact manifest/runtime API versions. Optional compiled server code receives
only the public hook context: row, old row, caller, new-row flag and a host-owned
validation failure function. No private AppError identity crosses the package.
Only owned-Table validation hooks are in the first contract. Code nevertheless
has full Node process privileges (filesystem, environment, network); browser
code has same-origin authenticated API/storage privileges. This is trust, not
sandboxing. Explicit operator paths are the only discovery source; no HTTP npm
installation, node_modules scan, arbitrary app HTTP endpoints or hot discovery.

## PKG-R2 — Identity and physical location are separate

> evidence: gap #296 — asymmetric API and storage proof pending.

| Logical identity | Display label | Owner | Physical schema | Physical relation |
|---|---|---|---|---|
| tasker.task | Task | tasker | tasker | task |
| other.task | Task | other | other | task |
| tasker.project | Project | tasker | tasker | project |

Every affected DDL, RLS, CRUD, reference and query path uses one metadata-backed
physical relation resolver. No pooled search_path mutation; no quoted dotted
single relation. Existing core identities remain unqualified. Local names and
display labels never resolve cross-app references. Ownership/storage metadata
cannot be changed through generic metadata edits.

## PKG-R3 — Installation, enablement and availability differ

> evidence: gap #296 — lifecycle tests pending.

Installation creates Tables and grants once. Disable preserves Tables, rows,
grants and ownership, removes launchability and server contributions, and denies
operations against those Tables even with warm metadata. Enable requires
compatible code and wires hooks once. Missing code fails closed at boot.
Lifecycle transitions must not remove validation halfway through an admitted
write; complete operations and transition ordering require explicit coordination.
Purge and complete upgrade orchestration are not part of this slice.

## PKG-R4 — Separate client root

> evidence: gap #296 — HTTP, Vite and browser tests pending.

Tasker owns `/apps/tasker/`, its React root, navigation and CSS. Core serves only
the declared client build root with containment checks. Missing assets never
fall back to either SPA. Vite proxies `/apps/`. Core router and AdminLayout
contain no Tasker import, route or name conditional. App switching can reload
the page. The signed-in app catalog is separate from manager-only management.

## PKG-H1 — Prototype residue and disabled references

> evidence: gap #296 — transition and reference tests pending.

Inspect local prototype rows read-only. A deterministic, transactional local
transition preserves row IDs, references, comments/history, settings and grants;
ambiguous destination collisions abort rather than discard data. No permanent
legacy aliases. A reference, child or reverse-reference operation that needs a
disabled app-owned Table rejects instead of resolving a same-local-name Table
or silently skipping a required write.

## Closure and deferred work

Authentication and existing permissions apply to every generic API. Catalog
launch access does not grant data access. Shared task edits retain optimistic
concurrency. Package failures are visible to managers; no secret paths need be
shown to ordinary users. Package artifacts may require restart. Marketplace,
signing, untrusted-code isolation, capability/dependency graphs, hot discovery,
full upgrade orchestration, purge, typed recents and generalized app settings
are deliberately deferred. Spec 0010 task behavior remains authoritative.
