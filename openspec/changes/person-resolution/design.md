# Design

Revision 3 (22-Oct-2026): round-1 review applied (reviewers A and B) and the
owner's **clean-start rule** applied — *"no backward compatibility. This is
the first real prod move, so let us start everything cleanly and wipe out any
bad decisions."* Prod is platform-only; dev's trial data is migrated as data.
Decisions D-a to D-d were taken by the coordinator under the owner's
principles and are settled.

## Context

This change builds on `person-identities` (PR #371, branch
`issue-275-identities`), which gives Featherbase one account per human with
several linked sign-ins, each keyed by the provider's permanent id; Sign In
Method rows as per-provider policy; one sign-in pipeline; admin and self
linking; a lockout guard; a leaver rule; audit rows; and (M1, added after this
design's first draft) opaque ids for people created by a Google sign-in. #371
is also removing its own shims (old `/api/brand` fields, the `.invalid`
storage shim, pre-upgrade sessions, `social_login`); nothing here relies on
them.

What it does not have: identifiers that do not sign in; a record of two
account records being one person; the time dimension; a review list; merge
and unmerge; a rule for what a merge may do to access.

Jeyarama's data (research §4): 2,159 Aadhaar numbers held by 2+ StyleHR
records, 665 spanning an agency → company conversion; 6,803 prior codes in
StyleHR's own `existing_emp_code`; phones shared 2,774 times; 28 employee
codes collide across firms, so the StyleHR surrogate record number is the only
unique record key. Dev holds 277 accounts (264 with the employee code as id),
~40 signing in through StyleHR daily. Prod is empty.

Three principles settle every routine choice (owner's decision principles):
**performs better without a major sacrifice · more consistent · cheaper or
faster.** Each decision names the one that decided it.

### Settled by the coordinator (round 1)

- **D-a. Population.** Phase 1 covers the people who **sign in or hold a
  role** — about 300, a review queue of tens. The whole workforce (~30k
  StyleHR records as people without sign-in) is Phase 2, with lanes and bulk
  confirm. Until then the warehouse resolves `21654 → RR-10353` from
  StyleHR's own `existing_emp_code` (6,803 rows) — D10.
- **D-b. Auto-link is out of this change** (D7).
- **D-c. #371 merges with only M1.** The first draft's M2 does not go into
  #371; `ended_at` and the corrected leaver rule land here (D5).
- **D-d. Phases.** 1a (days): identifiers with history, generic presets plus
  the Jeyarama seed pack, write-through, migration, manual "Merge into…" with
  a full preview, undo — Zain, RB and the mailbox. 1b: suggestions as
  clusters, Aadhaar fingerprinting, the review screen. 2: workforce
  population, lanes and bulk confirm, warehouse gold person, period scoping in
  the sales-target report, auto-link.

## Clean-start decisions (owner's rule, 22-Oct-2026)

Each earlier choice that was made "to avoid churn" is re-decided here on its
merits alone. Dev's trial data is migrated as data; nothing is kept for an
existing caller.

| # | Decision | Reason (merits only) |
|---|---|---|
| C1 | **The human's record is `person`, not `user`.** Table `person`, Admin "Person", API `/api/people/…`. Every `Reference → User` becomes `Reference → Person`; `data_scope.user` → `data_scope.person`; `has_role.parenttype = 'Person'`; the CDC maps `featherbase.person` → `access`. | A "user" is someone who uses the system; from Phase 2 most rows (~30k workforce) never will, and the owner's own words are "here is only one person". Identity platforms say User because for them the record *is* the login; Featherbase separates the login (sign-in identities) from the human, which is the HR/MDM split, and HR and MDM call the human **Person** (SuccessFactors Person ID, Workday Person, FHIR Person). Self-evident to a veteran and a newcomer; smuggles no second meaning. *Consistency.* |
| C2 | **Service accounts leave `person`.** A small raw table `service_account` (id `svc_…`, label, enabled, created_by) owns its tokens; its roles are `has_role` rows with `parenttype = 'Service Account'` (sub-tables already carry `parent` + `parenttype`). `getRoles` reads both parent types; `isPrivileged` too. Administrator and Guest stay built-in `person` rows (`built_in = true`): Administrator is operated by a human; Guest is the anonymous visitor the portal signs in as. | A script is not a person; keeping it in the human table forced "service account ⇒ refused" special cases into sign-in, identifiers and merge. Separate tables remove them. *Consistency; smaller blast radius.* |
| C3 | **Every person gets an opaque id (`psn_` + 20 random base32), including dev's 277.** The migration mints ids and rewrites references (the engine's `on update cascade` does the work once); the employee code becomes an identifier row. The roster sync never supplies ids; it resolves through identifiers (D11). | An id that is an employee code, email or username is a future rename (codes change on conversion, 28 collide across firms); every surveyed platform refuses such anchors (research §1). *Performs better without sacrifice.* |
| C4 | **#371's `user_identity` is renamed `sign_in_identity`** (raw table; no person prefix, like `access_token`), and its StyleHR **subject becomes the StyleHR record number** (`employee_employee.id`), not the employee code. `sign_in_name` stays the StyleHR login. Test mode (dev-only) looks a typed employee code up through the `stylehr-employee-code` identifier row. | "Identity" (authenticates) and "identifier" (does not) are the two words the design turns on; `user_identity` beside `person_identifier` would differ by two letters and a prefix. The record number is the only id StyleHR guarantees unique (28 code collisions). *Consistency.* |
| C5 | **The `employee_code` and `stylehr_username` Custom Fields are dropped** after the migration moves their values into identifier and sign-in rows. The sales-target report's scoping reads a person's **current** codes from identifier rows **in Phase 1a** (period-valid codes stay Phase 2). | No derived copy of a code anywhere but the two tables that own it. *Consistency; one search surface.* |
| C6 | **No `use` column.** "Current" = the period's upper bound is open; "old" = closed. | A derived flag with an agreement constraint is two places for one fact. *Cheaper.* |
| C7 | **`person.email` stays** as the person's primary contact address; every address a person has (including the primary) is also an `email` identifier row, kept in step by write-through. | Every mail sender reads one column; matching and search read one table. Decided on *performance* (not compatibility): the alternative — mail senders querying identifier rows for the `official` one — costs every sender a join for no behaviour gain. |
| C8 | **No `identity_links` probe, no `.invalid` acceptance, no pre-upgrade sessions, no `social_login`.** The sync is written against D11 directly. | #371 is removing them; relying on them would reintroduce them. |
| C9 | **Prod gets 0100 + the `person` rename + 0101 as one clean first migration; dev's data is migrated once.** | There is nothing in prod to keep. |

Where the `person` rename lands: it touches the sign-in surface #371 is still
rewriting, so the recommendation is to **fold it into #371** (its builder is
active and prod is empty); the fallback is a `rename-user-to-person` change
applied on the same stack before 0101. The coordinator decides; this design
uses the new names throughout.

## Goals / Non-Goals

**Goals**

- One `person` row per human who signs in or holds a role; every identifier
  they have or had attached, with validity period and source; old codes
  searchable and valid for their period.
- Identifier systems as configuration: kind-driven presets, a four-field basic
  form, Advanced with "revert to default"; the Jeyarama set as a seed pack so
  the 80 % case needs no set-up.
- Suggest-then-confirm matching; merge that keeps the loser, logs every move
  and deletion, previews effective access (gains and losses), undoes by
  compare-and-set.
- Aadhaar never stored; a keyed fingerprint with operational controls.
- A `canonical_person_id` the warehouse resolves transitively.

**Non-Goals**

- Auto-link (D7, deferred). Fuzzy matching (Phase 3).
- Featherbase as the system of record for employment facts.
- Aadhaar authentication or offline e-KYC.
- A 1M-customer loyalty programme: **`person` is the table of humans who can
  hold access.** A customer-scale party model would be an app-owned Table
  with its own matcher.
- Rewriting history columns (`owner`, `modified_by`, Activity Log, Version,
  Comment) on merge — D6.

## Verdict on #371

**Merge it, with M1 and the clean-start renames (C1, C2, C4).** Its model —
one record per human, sign-in identities keyed by `(method, subject)`, Sign In
Method rows as the authenticating subset of identifier systems — is the right
foundation. Everything below is additive on it.

- **M1 (in #371 now):** opaque ids for people created by a Google sign-in.
- **Not in #371:** `ended_at` and the per-identity leaver rule. Review A-B3
  showed the first draft's rule ("disable only when no other HR identity is
  live") unsafe: two StyleHR identities say nothing about whether either
  employment is live. The corrected rule (D5) needs roster-fed identifier
  rows, which exist only here.
- **Changed by the clean-start rule:** `User` → `Person` (C1), service
  accounts out (C2), `user_identity` → `sign_in_identity` with the record
  number as StyleHR subject (C4). Each is a rename plus a data migration of
  dev, not a model change.
- `sign_in_identity` stays separate from `person_identifier`: sign-in rows
  are security-critical with one write path; identifiers are HR data with
  wider edit rights. *Smaller blast radius.*

## Decisions

### D1. The person; its id is permanent; a replaced record is inert

- `person.row_id` = `psn_` + 20 random base32 characters, minted by
  Featherbase for every person (C3). A controller refuses any rename of a
  Person row; the engine's `on update cascade` stays as safety. Pinned by a
  test.
- `person.replaced_by varchar(140) null references person(row_id)` with
  `check (replaced_by is null or not enabled)` (A-M9). A replaced record:
  cannot sign in; cannot be picked in a Reference or assigned; resolves to its
  survivor wherever a person is looked up by identifier; **writes onto it are
  redirected** when the API carries a resolve key (D11) and **refused** with
  409 `replaced_by` otherwise, naming the survivor. Chains are repointed to
  the final survivor on every merge (D6), so the hop is always one.
- `person.built_in boolean` marks Administrator and Guest (C2): never merged,
  never replaced, never given identifiers.
- **One privilege helper** (`isPrivileged(principal)` = Administrator or
  System Manager, reading `has_role` once for either parent type) replaces
  the four inline checks in `sign-in.ts`, `identities.ts`, the lockout guard
  and the delegated verify step (B-M8).

### D2. Identifier System — kind-driven presets, a four-field form, Advanced underneath

A new system Table **Identifier System** (`featherbase.identifier_system`,
module Core, `system = true`, System Manager only; mirrored). One row = one
namespace of values (FHIR `Identifier.system`).

**Basic form:** `label`, `kind`, `source`, `match` (Off / Suggest), and one
**Sensitivity** choice — Normal / Restricted / Secret — which sets storage,
display and tier together:

| Sensitivity | storage | display | tier |
|---|---|---|---|
| Normal | plain | full | basic |
| Restricted | plain | full | restricted |
| Secret | fingerprint | last 4 | restricted |

**`kind` drives every other default** (Tableau: detected, labelled, revertible):

| kind | normalise | one holder at a time | one per person | assurance (derived) | match default | Sensitivity default | edited by default |
|---|---|---|---|---|---|---|---|
| `employee-record` (a code from an HR or payroll system) | upper | **on**, scoped by assigner | off | weak | Off | Normal | source |
| `external-record` (another system's record number) | trim | on | off | weak | Off | Restricted | source |
| `national-id` | digits | **off** (D3: matching needs a second holder to be *accepted*) | on | **strong** | Suggest | **Secret** | source + System Manager |
| `contact` (phone, email) | indian-mobile for phone, lower for email | off | off | weak | Suggest | Normal (phone: Restricted) | self + System Manager |

**Advanced** (collapsed; every field shows its preset and "revert to
default"): `normalise`, `one_holder_at_a_time`, `one_per_person`, `edited_by`
(`source` / `system-manager` / `reviewers` / `self`), `retain_after_leaving_days`
(Secret only, default 365), `enabled`. Options the rules forbid are disabled
in the form with the reason. **Cut from Phase 1** (B-M7): a `format` regex
(the Verhoeff check is built into `national-id` + 12 digits), `editor_roles`
(one `reviewers` role, D9), and per-system DDL (D3 uses denormalised flags and
one partial index). `assurance` is **derived from kind** (national-id strong,
all else weak), not stored; `match` is the only matching setting.

Controller rules:

- **`match ≠ Off` ⇒ `one_holder_at_a_time = off`** (A-B1 = B-B1). A matching
  system must *accept* a second holder to raise the suggestion; the unique
  constraint is kept only for key and code systems and for sign-in subjects.
  "One person, one Aadhaar" is enforced through review.
- Secret requires Sensitivity-consistent settings; a direct API write that
  disagrees is refused.
- A system that holds rows cannot be deleted (409); disable it. Turning
  `one_holder_at_a_time` on is refused while current duplicates exist.
- Sign In Method gains an optional `identifier_system` reference ("my subject
  is a value of this system"): set to `stylehr-employee-id` for the delegated
  StyleHR row (C4). Password and Google have none (a Google `sub` means
  nothing outside Google; its verified email is a `contact` identifier).

**Core ships generic rows only** (B-M8): `phone` (contact, indian-mobile,
Restricted, Suggest) and `email` (contact, lower, Normal, Suggest). **The
Jeyarama rows are a seed pack**, `seeds/jeyarama/identifier-systems.json`,
applied by `cli seed-pack apply jeyarama` (idempotent):

| key | label | kind | assigner scope | Sensitivity | match | edited by |
|---|---|---|---|---|---|---|
| `stylehr-employee-id` | StyleHR record number | external-record | — | Restricted (hidden in panels) | Off | source `stylehr-roster-sync` |
| `stylehr-employee-code` | StyleHR employee code | employee-record | the StyleHR firm | Normal | Off | source |
| `aadhaar` | Aadhaar | national-id | — | Secret | Suggest | source + System Manager |

"Agency code" is not a separate system: an agency worker's code lives in the
same StyleHR field and closes on conversion (D4); StyleHR's
`existing_emp_code` arrives as a closed row.

### D3. Person Identifier — one row per value a person has or had

Raw platform table `person_identifier` (controller-written only):

| column | meaning |
|---|---|
| `id` | `pid_` + random |
| `person_id` | → `person.row_id`, `on delete restrict` |
| `system` | → `identifier_system.row_id`, `on update cascade on delete restrict` |
| `assigner` | who issued the value (a StyleHR firm, "agency", a Workspace domain); `''` when the system has no assigner scope. Part of the key for `employee-record` systems (A-M2) |
| `value` | the normalised value; **NULL for Secret systems** |
| `value_hint` | last 4 characters for Secret systems; NULL otherwise |
| `valid` | `daterange`, half-open `[valid_from, valid_to)`. Lower bound `-infinity` means "since before Featherbase knew the person" (the backfill, and the sync when StyleHR has no start date); upper NULL means current (A-M3). No `use` column (C6) |
| `verified` | `true` when written by a source feed, by sign-in write-through or by a System Manager / reviewer; `false` for a self-asserted value (A-M6a) |
| `one_holder`, `one_per_person` | denormalised copies of the system's flags at write time (B-M7) |
| `source` | `stylehr-roster-sync` \| a person id \| `sign-in` \| `migration` |
| `recorded_at`, `recorded_by`, `note` | audit |

Fingerprints live in a **separate raw table** so they are never mirrored
(A-M11, B-M5): `person_identifier_fingerprint (identifier_id pk →
person_identifier on delete cascade, fingerprint bytea, key_id text,
erased_at timestamptz)`. The CDC registration denies it by name.

Constraints (one partial index each, no per-system DDL):

- `exclude using gist (system with =, assigner with =, value with =, valid
  with &&) where (one_holder and value is not null)` — no two holders of one
  key value overlap in time (A-M3). Contact systems have `one_holder = false`,
  so a store phone held in turn is fine.
- `unique (person_id, system) where upper(valid) is null and one_per_person`.
- No uniqueness on fingerprints: Secret systems match, so they accept a
  second holder.

Changing a system's flags re-stamps its rows inside the save; turning a flag
on is refused while duplicates exist.

Reads: the generic APIs return `value` for Normal and Restricted (the latter
only to readers with restricted access on Person), the hint for Secret, never
the fingerprint. Search matches on `value`; on `value_hint` when exactly four
digits are typed for a Secret system; and on the fingerprint when a reader
with restricted access types a full value — **audited (actor, system, hint,
time) and rate-limited** per actor; the typed value is fingerprinted in memory
and discarded. Errors never echo a value.

Logging: a write that changes nothing writes no Activity Log row and no
Version.

### D4. History: conversion, rehire, code change, two live employments, mailbox

The time dimension lives on identifier rows. **The sync closes codes; the
merge only moves rows** (A-M4):

- **Agency → company conversion.** StyleHR terminates record `21654` (agency
  firm) and opens `RR-10353`. The sync closes `21654`'s code row (`valid_to`
  = StyleHR's termination date) and writes `RR-10353`'s code and Aadhaar. The
  fingerprint matches → a strong cluster (D6). On confirmation the merge
  moves rows; no period changes. Searching `21654` finds the person; a report
  for a month before the conversion still attributes `21654`'s sales to them.
- **Rehire, same code:** the sync opens a new current row with the new start
  date; the closed spell stays. **Rehire, new code:** a new record whose
  Aadhaar matches → cluster → merge; the old code stays closed.
- **Two live employments at once** (two firms' payrolls): two current code
  rows with different assigners. Allowed — `one_per_person` is off for codes.
- **Code correction inside StyleHR:** a new code on a record number
  Featherbase knows (`stylehr-employee-id`) closes the old code and opens the
  new one. No suggestion — the record number proves identity.
- **Store mailbox** (`sm.atk@jeyarama.com`, a Google account passing between
  Store Managers): #371's move endpoint now **ends the old sign-in row**
  (`ended_at = now`, `ended_reason = moved`) and inserts a new one, closes the
  previous holder's `email` identifier row and opens one for the new holder —
  "who held the mailbox in May?" is a query.

### D5. Sign-in identities: write-through, ended identities, the leaver rule

- **Write-through.** When `sign_in_identity` gains a row whose method has an
  `identifier_system`, the controller writes the matching `person_identifier`
  row (`source = sign-in`, `verified = true`); ending the identity closes the
  row. Google identities write an `email` row from the verified address they
  returned (RB's three Google accounts show as three emails on one person).
  The sign-in path never reads the copy — **except dev-only test mode**, which
  resolves a typed employee code through the current
  `stylehr-employee-code` row (C4), pinned by a test as the one exception.
- **Migration of dev (0101):** mint `psn_` ids (C3); one
  `stylehr-employee-code` row per person from the roster's `employee_code`
  Custom Field (never from the old subject, which was the Featherbase id;
  A-M2), `assigner` from the roster's firm when known, else `''`; rewrite
  StyleHR subjects to record numbers from the sync's resolve data (persons the
  sync cannot resolve are listed by `people:plan` and their StyleHR sign-in is
  ended until the sync links them); one `email` row per Google identity email
  and per `person.email`; then drop both Custom Fields (C5).
- **Ended identities** (A-B2). `sign_in_identity` gains `ended_at timestamptz`,
  `ended_reason` (`left` \| `moved` \| `unlinked`). The subject and
  sign-in-name unique indexes are partial `where ended_at is null`;
  `linkedBySubject`, `linkedUser` (delegated candidate lookup) and
  `resolveToken` all add `ended_at is null`. **An ended identity never opens
  an account**, and its session ends on the next request. Unlink ends the row
  instead of deleting it. Pending invites are unaffected.
- **Leaver rule** (A-B3). When a connected service answers `left` for identity
  I of person P: (1) end I (`left`); audit `identity_ended_left`; (2)
  **liveness comes from roster-fed employment rows**: P is live iff P has a
  current, `verified`, source-fed `employee-record` row whose assigner is not
  I's; (3) if live, P stays enabled (the conversion case); **if liveness is
  unknown** — no roster-fed employment rows at all — **disable P exactly as
  #371 does**; (4) the roster sync's `--disable-leavers` applies the same
  per-person test and remains the backstop.

### D6. Suggest (as clusters), review, merge, undo

**Clusters, not pairs** (B-M1). Raw table `person_match` (controller-guarded):
one row per `(system, assigner, value or fingerprint)` held by two or more
different persons on **verified** rows (A-M6a):

| column | meaning |
|---|---|
| `id` | `pm_` + random |
| `system`, `assigner`, `value_key` | the shared value (`value`, or the fingerprint hex for Secret systems; screens show the hint) |
| members | child raw table `person_match_member (match_id, person_id, identifier_id, added_at)`; a cluster grows as records arrive |
| `strength` | `strong` when the system is `national-id` **and** the cluster has exactly 2 members; `weak` otherwise. **3+ members = a "suspicious group"**: one cluster, weak, with a hint that the value may be a placeholder or a data-entry habit |
| `status` | `open` \| `deferred` (cap) \| `later` (`snoozed_until`) \| `merged` \| `not-the-same-person` \| `withdrawn` |
| `decided_by`, `decided_at`, `decision_note`, `reopened_at`, `reopen_reason` | the steward's decision and any reopen |

Rules:

- A cluster is raised once per shared value. **`not-the-same-person` sticks**
  — *until a stronger-assurance reason arrives* for the same members (a pair
  rejected on `phone` later shares an Aadhaar fingerprint): the new cluster
  is raised and the old one **reopened** with `reopen_reason` (B-M2).
  `POST /api/people/matches/:id/reopen` and a "Reopened" filter let a steward
  reopen by hand with a note.
- `later` snoozes for N days (default 30) and returns to `open`.
- When a member is merged away, the cluster is re-evaluated: one member left
  ⇒ `withdrawn`; the merged-away record's decisions **carry to the survivor**
  by rewriting the member row (A-M9).
- **Matching re-runs on moved identifiers** after a merge or an undo (A-M9).
- **Daily cap** on new open clusters (`people.max_new_suggestions_per_day`,
  default 50): beyond it detection records clusters as `deferred`; the review
  header shows "N deferred — cap reached"; the next run promotes them.
- A scheduled job re-scans on any system's `match` change and weekly (D13).
- Phase 1b matches exact normalised values only; fuzzy rules are Phase 3.

**Review screen** (`/featherbase/admin/people/duplicates`, Phase 1b): open
clusters, strongest first, members side by side. **Columns and the survivor
rule are configuration** (B-M8): a `people_review` JSON on System Settings,
shipped as `{compare: [full_name, codes_with_periods, worker_type_from_roster,
roles, data_scope, sign_in_methods, last_sign_in], survivor_rule:
[live_employment, last_sign_in, oldest]}`. Actions: *Merge*, *Not the same
person* (note required), *Later*. Header: open, deferred, reopened counts.

**Merge preview and confirm** (`POST /api/people/merge`, `preview=1` first;
also from any Person form via "Merge into…" so a merge needs no cluster —
`match_id` is nullable; RB's three Google accounts share no identifier, B-M2):

1. **Who may merge:** a reviewer (`Data Quality Manager`, D9) or a System
   Manager; **never a party to the merge** (A-M6b); never a `built_in` record.
2. **Survivor** by the configured rule; the reviewer may swap.
3. **Refusals** (each names its reason):
   - **different current strong identifiers** (two Aadhaar fingerprints) —
     refused; an Administrator may override with a recorded `override_note`
     (A-M5);
   - the merged-away record holds a privileged role the survivor lacks, **or
     the merge adds any way in (sign-in identity, password) to a privileged
     account** (A-M6c) — Administrator only, no reviewer override;
   - either record already `replaced_by` — 409 naming the survivor.
4. **Effective access per table, gains and losses** (A-M1). Roles: union,
   listed as gains. Shares: union. **Data Scope rule:** per table, both sides
   restricted → union (gains listed); **one side unrestricted on a table and
   the other restricted** → a union would *narrow* the unrestricted one; the
   preview shows the **loss** ("unrestricted on Store → restricted to ATK")
   and the reviewer chooses per table; the **default is the narrower set**
   (fail closed). The reviewer ticks "I have checked the access this person
   gains and loses".
5. **Survivorship, field by field:** `full_name` from the survivor unless
   empty; **`email` cleared on the loser and kept as an `email` identifier
   row**, restored on undo; `language` survivor's; `enabled` survivor's — the
   loser's pre-merge `enabled` is recorded for undo (A-M7).
6. **The move walk uses a handler registry** (A-M8). Each handler knows how
   to move, how to detect a dedupe deletion, and how to undo. Registered:
   - metadata `Reference → Person` columns in every Table (walked from
     `column_def where reference_table = 'Person'`), including app and runtime
     tables;
   - **Dynamic Reference** columns whose type column names `Person` (Share's
     target, Data Scope `for_value` when `allow = Person`, Notification);
   - raw tables: `has_role` (dedupe on role), `data_scope` (per 4), `share`,
     `sign_in_identity` (all rows incl. pending invites), `person_identifier`,
     `user_settings` (survivor's key wins; the loser's deleted row logged),
     `saved_view.owner`, `password_reset` (loser's rows revoked),
     `person_match_member`; (`access_token.owner` is a service account after
     C2 and needs no handler);
   - JSON and text ids: `home_page` owner, saved-view filter JSON, assignment
     rule conditions — each handler lists the JSON paths it rewrites;
   - history columns (`owner`, `modified_by`, Activity Log, Version, Comment)
     are **registered as "not rewritten"** so the completeness test accepts
     them knowingly.
   **Completeness test:** enumerate `pg_constraint` foreign keys to `person`,
   plus every `Reference` / `Dynamic Reference` column to Person in metadata,
   and fail on any column no handler claims. A bound-source column the engine
   cannot update is reported in the preview, not skipped.
7. **Deletions are logged** (dedupe of roles and settings; the loser's
   `has_role`/`data_scope` rows after the union) so undo can recreate them
   (A-M7). The loser ends with no roles, no scope, no identities, `enabled =
   false`; nothing is orphaned — every row is moved or logged-and-deleted.
8. **Transaction and locking** (A-M7): both `person` rows locked `for update`
   in `row_id` order; (1)–(3) re-checked inside the lock; the walk runs;
   `replaced_by` set on the loser; every record whose `replaced_by` pointed at
   the loser **repointed to the survivor**; `person_match_member` rows
   rewritten; matching re-runs on the moved identifiers.
9. **Person Merge** row (raw, controller-written): `id`, `survivor_id`,
   `merged_id`, `match_id null`, `merged_at`, `merged_by`, `override_note`,
   `survivorship` JSON, `scope_choices` JSON, `moved` JSON (handler, table,
   row, column, before, after), `deleted` JSON, `loser_enabled_before`,
   `undone_at`, `undone_by`, `undo_note`, `undo_leftovers` JSON. Activity Log
   rows on both persons. **Never mirrored** (B-M5): the CDC denies
   `person_merge`; the warehouse reads `person.replaced_by`.

**Undo** (`POST /api/people/merge/:id/undo`, A-M7):

- **Compare-and-set per row:** a moved row reverts only if it still holds its
  post-merge value; a deleted row is recreated only if its key is free; a
  survivorship field only if it still equals the chosen value. Everything else
  goes to `undo_leftovers`, shown on the History entry and as a banner on both
  records.
- Restores the loser's pre-merge `enabled`, clears `replaced_by`, repoints
  records repointed *by this merge* back to the loser, restores `email`.
- **Allowed beyond the latest merge** where compare-and-set permits. **What
  blocks it:** the loser has since been re-merged (its `replaced_by` no longer
  points at this survivor) or the survivor has since been merged away — undo
  that later merge first; the API names it. An unrelated later merge *into*
  the survivor does not block; its rows fail compare-and-set and are listed.
- Does **not** decide the cluster: the steward chooses (B-M2). Matching
  re-runs on the returned identifiers. Locks in `row_id` order; logged.

### D7. Auto-link — deferred (D-b)

Not in this change. When it returns it needs a **second signal** besides the
strong identifier (name + date of birth agreement, non-overlapping employment
periods, the value held by exactly two records across all of StyleHR), the
**baseline-role gate** (both records at or below a configured baseline role,
no Data Scope rows, never a sign-in subject system), and the controls from the
first draft (off by default, recorded as `auto-link:<system>`, undoable).
Rollout idea (reviewer B): keep everything on Suggest, measure the undo rate
on "clean conversion" clusters, and flip that one case to auto-link once the
undo rate has stayed at zero for a period the owner picks.

### D8. Aadhaar — never stored; the fingerprint is personal data with operations around it

- **Never stored, never shown.** Secret storage: Featherbase receives the
  number once (TLS, from the sync or typed by a System Manager), normalises
  to 12 digits, checks the Verhoeff digit, computes `HMAC-SHA-256(key,
  digits)`, keeps the fingerprint and the last four digits, and discards the
  number. Request bodies for Secret systems are excluded from request
  logging; the Activity Log records only the hint (`XXXX XXXX 1234`, UIDAI's
  masked form).
- **Why keyed:** ~8×10¹⁰ valid numbers make a plain SHA-256 reversible by
  enumeration (research §3).
- **Key operations** (A-M11 = B-M4): `IDENTIFIER_FINGERPRINT_KEY` (server
  env, ≥32 random bytes, never in the database or logs) with a **key id**
  (`first 8 hex of HMAC(key, "featherbase-key-check")`) stamped on every
  fingerprint row and stored as a **key-check value** in System Settings on
  first use; **startup check** — key present and key-check matches, else every
  Secret system is *degraded* on `/api/health` (`fingerprint_key_ok = 0`) and
  the server still boots; **refusal per identifier** — a Secret row in a bulk
  upsert answers `fingerprint_unavailable` while the rest lands;
  **re-fingerprint** — `mode: refingerprint` (D11) rewrites rows for one key
  id from the source feed, `cli people:fingerprints --status` lists rows per
  key id; **never mirrored** — fingerprints live in
  `person_identifier_fingerprint`, denied in the CDC; **full-value search**
  audited and rate-limited (D3); **erasure** — a daily job nulls the
  fingerprint (`erased_at` set) once a person has had no current employment
  row for longer than `retain_after_leaving_days` (default 365) and is
  disabled; the hint stays for history. **The DPDP Act treats a keyed
  fingerprint as personal data** (it relates to an identifiable person), so
  retention and erasure apply to it as to the number; errors never echo the
  value.
- **Why Featherbase fingerprints rather than the sync:** one key holder. The
  alternative — the warehouse asserts "records A and B share a national id" —
  keeps Aadhaar out of Featherbase but makes the warehouse the matcher.
  Rejected on *consistency*; the fallback if the lawyer says otherwise.
- **Legal basis** (research §3, not legal advice): voluntary collection with
  informed consent and an offered alternative (Aadhaar Act s.4(3), s.4(6) as
  amended 2019); Sharing of Information Regulations bind everyone to
  confidentiality, no display, no publication, no retention beyond purpose;
  DPDP s.7(i) employment processing with s.8 safeguards and erasure.
  **UNCERTAIN, for a lawyer:** whether the fingerprint counts as "storing";
  whether an internal last-four screen is "display" (UIDAI's own masked
  Aadhaar shows them); the DPDP Rules commencement date.
- **Owner decisions flagged:** (1) the sync needs **direct read access to
  StyleHR's Aadhaar table** for fingerprinting (today it reads the warehouse
  mirror); (2) `bronze_stylehr.public.employee_employeeidentity` in MotherDuck
  holds **28,770 full Aadhaar numbers in clear** (+35 in
  `employee_aadhaarverification`, + nominee numbers) — mask or drop at the
  bronze loader. Filed in data-warehouse at close-out.

### D9. Who may change what; the reviewer role

`edited_by` on the system: `source` systems are read-only on screens (a
correction goes to the source — the settled HR rule: disagreements go to a
review list, never auto-resolved); `system-manager`; `reviewers` = the `Data
Quality Manager` role; `self` lets a person add or end their own contact
values (`verified = false`, never a match reason). Every *real* change is an
Activity Log row with actor, system, hint and period.

**`Data Quality Manager`** (created by the migration if absent; B-m1): read
the restricted tier on Person and identifiers; add/end/correct values on
systems whose `edited_by` includes `reviewers`; decide clusters; merge and
undo within D6's refusals; **no** write on Sign In Method, Identifier System
or roles. Administrators additionally override A-M5 refusals and carry
privileged roles. **`Identity Sync`** (D11) writes identifiers on `source`
systems and resolves; nothing else.

### D10. What the warehouse consumes

- **Phase 1 population is the ~300 who sign in or hold a role (D-a).** Until
  Phase 2 populates the workforce, the warehouse resolves prior codes from
  StyleHR's `existing_emp_code` (6,803 rows) in `silver_stylehr`.
- `person_id` = `person.row_id`, immutable (D1), mirrored at
  `bronze_featherbase.access.person`. **Consumers never snapshot
  `person_id`**: gold exposes `canonical_person_id`, resolved **transitively**
  through `replaced_by` (recursive CTE capped at 10 hops, with a test that no
  chain exceeds 1 after repointing), and every fact joins through it.
- CDC registration: `person`, `identifier_system`, `person_identifier`,
  `person_match`, `person_match_member` in `system_tables` (schema `access`);
  **deny** `person_identifier_fingerprint`, `person_merge`, `sign_in_identity`,
  `service_account`.
- Gold (Phase 2): `gold.hr.person` (`canonical_person_id`, display name,
  worker type from StyleHR, current codes) and `gold.hr.person_identifier`
  (person, system, assigner, value, `valid_from`, `valid_to`) for Normal
  systems. **Period-join rule:** a fact joins the row whose `valid` contains
  the fact date (`valid_from <= d < valid_to`); key systems cannot overlap
  across persons (exclusion constraint); overlapping rows within one person
  (two live employments) resolve to the same `canonical_person_id`; a fact
  matching no row maps to the code's most recent holder and is flagged
  `period_gap`.
- Report scoping in Featherbase (`sales-target.ts`): **current** codes from
  identifier rows in Phase 1a (C5); period-valid codes in Phase 2 (#4332 C1).

### D11. Sync API (data-warehouse#4336 cites this section)

Credential: an access token of a `service_account` holding **`Identity
Sync`**. Endpoints:

- `POST /api/people/identifiers:bulk` — `{mode: "upsert" | "refingerprint",
  create_missing: bool, rows: [{person: {system, assigner?, value}, system,
  assigner?, value, valid_from?, valid_to?, note?}]}`. `person` is a
  **resolve key** — an identifier that already finds the person (the StyleHR
  record number, normally). A row whose resolve key finds nobody creates a
  person with a `psn_` id when `create_missing` is true (the sync sets it
  for the ~300 in Phase 1, for the workforce in Phase 2). `valid_to` set
  closes the row.
  - **Idempotent:** an unchanged row writes nothing and no log row.
  - **Redirect for a replaced target:** a resolve key landing on a replaced
    record writes to the survivor; the row result carries `resolved_person`
    and `redirected: true`.
  - **Per-row results:** `created | updated | unchanged | redirected | error`
    with a code (`fingerprint_unavailable`, `invalid_format`, `overlap`,
    `system_disabled`, `not_allowed`); 200 with the array; nothing aborts the
    batch.
  - `mode: refingerprint` rewrites Secret rows for the given key id only.
- `POST /api/people/sign-ins:bulk` — the StyleHR links `{person: <resolve
  key>, method: "stylehr", subject: <record number>, sign_in_name}`, same
  result shape; replaces #371's per-person link calls for the sync.
- `POST /api/people/resolve` (read-only) — `{keys: [{system, assigner?,
  value}]}` → `[{key, person_id, canonical_person_id, replaced}]`. Used by the
  sync before deciding leavers (D5) and by the warehouse's checks.
- `GET /api/people/:id/identifiers` — as D3 reads, Secret values as hints.
- Rate limits: a per-token bucket sized for a workforce run.

**Owner decision:** direct StyleHR read access to the Aadhaar table for the
sync (D8).

### D12. Screens (generic where it can)

- **Identifier System**: the generic FormView, basic/Advanced as a layout
  section, the controller's 417s as field errors; Sensitivity is a computed
  field that writes the three columns.
- **Person form → Identifiers panel** (beside #371's Sign-in methods panel):
  rows grouped by system, value or hint, period, source, verified mark,
  add/end where allowed; "Merge into…" for reviewers; banners "merged into
  <survivor>" and "Undo left N rows for your decision".
- **Duplicates** (Phase 1b): the review screen (D6) with configured columns,
  the merge preview (gains and losses per table, survivorship, the
  acknowledgement), History with Undo and leftovers, a Reopened filter.
- Search results show a replaced record as "→ <survivor>".

### D13. Observability

- Gauges: `people_open_clusters`, `people_deferred_clusters`,
  `people_reopened_clusters`, `fingerprint_key_ok`,
  `fingerprint_rows_by_key_id`, `replaced_chain_max_length` (alert if > 1).
- Counters: `people_merges_total{by=reviewer|admin}`, `people_undos_total`,
  `identifier_writes_total{system,result}`, `fingerprint_lookups_total`,
  `identifier_erasures_total`.
- Alerts: key degraded; undo rate > 10 % of merges over 30 days; deferred
  clusters > 0 for 3 days; any chain longer than 1; a sync batch with > 5 %
  error rows.
- Scheduled jobs (`background_job`): re-scan on policy change and weekly;
  erasure daily; snooze expiry daily.

## Use cases walked through

1. **Zain** (SM of ATK): person `psn_…` with a StyleHR sign-in (subject = his
   record number) and a code row. He links his Google account (#371
   self-link); the Google identity writes an `email` row. One record, two
   ways in, three identifiers. Phase 1a.
2. **RB**: created by Google with a `psn_` id (M1/C3). He self-links his
   `rct.in` and `theramachandran.com` accounts; each adds an `email` row. An
   older account IT made for one of those addresses shares no identifier with
   his record, so no cluster exists: Siraj opens it and uses **"Merge
   into…"** — a manual merge with `match_id = null`; the preview shows the
   roles RB would gain. Phase 1a.
3. **`21654` → `RR-10353`**: the sync closes `21654`'s code (`valid_to` =
   termination) and writes `RR-10353` with its Aadhaar; the fingerprint
   matches → strong cluster of 2. The Data Quality Manager sees worker type
   Agency until 02-Mar and Regular from 03-Mar, the same last four digits, no
   access differences, and merges with `RR-10353`'s record as survivor. Last
   February's report still finds them. Phase 1b.
4. **Two different people**: a shared family phone makes a weak cluster; the
   screen shows their Aadhaar hints differ. The reviewer marks "not the same
   person". If a later feed shows the same Aadhaar on both, that cluster is
   raised and the phone decision reopens with the reason.
5. **A suspicious group**: one phone number on 17 records (an agency's office
   line) is one weak cluster, not 136 pairs; marked once.
6. **Wrong merge**: two namesakes merged a week ago; undo reverts by
   compare-and-set, recreates the deduped role, restores `enabled` and
   `email`, lists the two rows added since.
7. **Undo blocked**: the survivor was later merged into a third record;
   undoing the first is refused until the second is undone (the API names it).
8. **Leaver**: StyleHR says `left` → the identity ends. A person the roster
   feeds with another current employment row (different firm) stays enabled;
   a person with none, or one the roster never touched, is disabled as in
   #371.
9. **Rehire with a new code**: a new StyleHR record whose Aadhaar matches →
   strong cluster → merge; the old code stays closed.
10. **Missing fingerprint key**: every plain row of the batch lands; each
    Aadhaar row answers `fingerprint_unavailable`; `/api/health` shows the
    Secret systems degraded; no plain hash is ever written.
11. **Store-manager mailbox**: the Google identity is moved; the old sign-in
    row is ended `moved`, the old SM's `email` row closes, the new SM's opens.

## Migration (`0101_person_resolution.ts`, idempotent, rehearsable; stacked on #371's `0100` and the `person` rename)

1. Identifier System Table + the two generic rows; the `Data Quality Manager`
   and `Identity Sync` roles; `service_account` (C2) with its rows moved from
   `person` and `has_role.parenttype` rewritten; `person_identifier`,
   `person_identifier_fingerprint`, `person_match`, `person_match_member`,
   `person_merge` with the exclusion and partial indexes; `person.replaced_by`
   + check, `person.built_in`; `sign_in_identity.ended_at`, `ended_reason`,
   the partial unique indexes; `sign_in_method.identifier_system`; the
   `people_review` setting.
2. **Dev data migration (D5):** mint `psn_` ids; code rows from the
   `employee_code` Custom Field; StyleHR subjects rewritten to record numbers
   from the sync's resolve file; `email` rows; drop the two Custom Fields.
   Prod has no data and skips this step.
3. Read-only `cli people:plan` prints the id map, the backfill, unresolved
   StyleHR sign-ins and the clusters it would raise (nothing is merged).
4. Seed pack `jeyarama` applied by the deploy step.

**DEPLOY.md order** (task 5.1): (1) #371's `0100` and the `person` rename are
live; (2) `cli people:plan`, snapshot; (3) generate
`IDENTIFIER_FINGERPRINT_KEY` and back it up offline (a lost key means
re-fingerprinting the workforce); (4) deploy the server (0101 runs; key-check
written on first use); (5) `cli seed-pack apply jeyarama`; (6) run the updated
sync; (7) post-deploy counts: identifier rows per system, open clusters,
`fingerprint_key_ok = 1`, `replaced_chain_max_length = 0`, zero rows left in
the dropped Custom Fields. Rollback: forward-fix; the snapshot as backstop.

## Risks / Trade-offs

- **The fingerprint key is a single secret.** Losing it means
  re-fingerprinting from StyleHR (`refingerprint` mode); leaking it makes
  fingerprints enumerable. Env-only, key id on rows, offline backup, and the
  bronze flag (D8).
- **Accepting a second Aadhaar holder** (D2 rule) means the database no longer
  enforces "one person, one number"; the review queue does, and the gauge
  shows how many strong clusters are open.
- **Merge walk completeness** rests on the registry test; a new raw table
  with a person column fails CI until a handler claims it.
- **The `person` rename and service-account split widen #371.** Both are
  mechanical and prod is empty; the cost is review time now against a rename
  that would never otherwise happen.
- **Two copies of a StyleHR code** (`sign_in_identity.subject` is now the
  record number, so the code lives only in `person_identifier`; the record
  number is the copy): write-through keeps them equal; a test pins that
  sign-in never reads the copy outside test mode.

## Test plan

Server (Vitest, SQL sandbox):

- `identifier-systems.test.ts` — kind presets; Sensitivity sets the three
  columns; `match ≠ Off ⇒ one_holder off` (a second holder is **accepted and
  a cluster raised**); Secret consistency; no delete while in use; one-holder
  flag refused while duplicates exist; seed pack idempotent.
- `person-identifiers.test.ts` — normalisation per kind; Verhoeff;
  fingerprint in its own table, hint = last 4, `key_id` stamped; half-open
  periods, lower-unbounded meaning, exclusion for key systems scoped by
  assigner; `verified` false for self; display/tier filtering; search by
  value / hint / fingerprint with audit and rate limit; no log row on an
  unchanged write; missing or mismatched key ⇒ per-row
  `fingerprint_unavailable`, health degraded, never a plain hash; errors
  carry no value; erasure job; Person id rename refused.
- `person-matches.test.ts` — cluster on a shared verified value;
  self-asserted never raises; 3+ members weak; strong only for national-id
  with 2; sticky `not-the-same-person`; reopen on a stronger reason and by
  hand; `later` expiry; `withdrawn` on merge; decisions carried; re-run after
  merge/undo; daily cap and deferred promotion.
- `person-merge.test.ts` — configured survivor rule; preview gains and
  losses per table incl. unrestricted → restricted with fail-closed default;
  refusals (different strong identifiers with Admin override, privileged
  role, way in added to a privileged account, party to the merge, replaced
  or built-in record); registry walk and the **completeness test**;
  deletions logged; loser left with nothing; history columns untouched;
  chains repointed; email cleared; locks in order with re-check; undo by
  compare-and-set with leftovers, recreated deletions, restored `enabled`
  and `email`, blocked by a later re-merge, allowed past an unrelated later
  merge, does not decide the cluster; writes onto a replaced record redirect
  or 409.
- `sign-in` adaptations — ended identity never opens an account
  (`linkedBySubject`, `linkedUser`, `resolveToken`); partial indexes let an
  ended subject be re-linked; `left` ends the identity and disables only
  when no roster-fed live employment exists or liveness is unknown; unlink
  ends, not deletes; move ends + inserts and closes/opens `email` rows;
  write-through; test mode resolves a code through identifiers and is the
  only sign-in read of them; service accounts cannot sign in because they are
  not persons.
- `sync-api.test.ts` — bulk upsert idempotent; redirect; per-row errors;
  `create_missing`; `refingerprint`; sign-ins bulk; `resolve`; `Identity
  Sync` limits.
- `migration-0101.test.ts` — dev-shaped fixture: ids minted and references
  rewritten; backfill reads the Custom Field, not the old subject; StyleHR
  subjects rewritten; unresolved sign-ins ended and listed; Custom Fields
  dropped; idempotent re-run; `people:plan` parity; service accounts moved
  with their roles.

Web: Identifier System form basic/Advanced with revert and disabled options;
Identifiers panel by display rule and banners; Duplicates screen with
configured columns, preview gains/losses, acknowledgement, Undo, leftovers,
Reopened filter. E2E: sync-shaped set-up → cluster → merge → sign in through
the merged-away StyleHR login opens the survivor → undo → the ended identity
does not open the loser.

Warehouse (data-warehouse repo, Phase 2): CDC registration validate with the
denies; `canonical_person_id` resolves transitively; every current key value
maps to one person; period join as-of the fact date.

Gates: server and web typecheck, full suites, `pnpm check:specs`,
`git diff --check`.
