# Design

## Context

This change builds on `person-identities` (PR #371, branch
`issue-275-identities`), which gives Featherbase:

- **User = the person.** `user.row_id` is the key everything references
  (`has_role`, `data_scope."user"`, every `Reference → User` column, the
  roster-created `employee_code` Custom Field). Email is optional contact data.
- **`user_identity`** — one row per sign-in identity, `UNIQUE(method, subject)`,
  subject = the provider's permanent id (Google `sub`, StyleHR employee code,
  the User id for passwords). Many rows per person are allowed.
- **Sign In Method** — a system Table of per-provider policy rows.
- A shared pipeline (`sign-in.ts`), admin link/invite/move/unlink endpoints,
  self-link with a fresh session, a lockout guard, a leaver rule, audit rows.

What it does not have: identifiers that do not sign in; a record of two
account records being one person; the time dimension (a code that was valid
until a conversion); a review list; merge and unmerge; a rule for what a merge
may do to access.

Jeyarama's data (research §4): 2,159 Aadhaar numbers held by 2+ StyleHR
records, 665 spanning an agency → company conversion; 6,803 prior codes;
phones shared 2,774 times. Featherbase dev holds 277 users, `row_id` =
employee code for 264 of them, ~40 signing in through StyleHR daily.

Three principles settle every routine choice below (owner's decision
principles, `data-warehouse/docs/business-rules/warehouse-decision-principles.md`):
**performs better without a major sacrifice · more consistent · cheaper or
faster.** Each decision names the one that decided it.

## Goals / Non-Goals

**Goals**

- One record per human; every identifier the human ever had attached to it,
  with validity period and source; old codes searchable and usable for the
  periods they were valid.
- Identifier systems as configuration with Jeyarama defaults shipped, so the
  80 % case needs no set-up.
- Suggest-then-confirm matching by default; auto-link as a per-system opt-in
  that can never touch a way in or privileged access.
- Merge that keeps the loser, logs every move, previews access changes, and
  can be undone in one action.
- Aadhaar never stored, never shown beyond its last four digits.
- A `person_id` the warehouse can join on forever.
- Fit inside #371's model with additive changes only — no second migration of
  live users.

**Non-Goals**

- Fuzzy (name + date of birth) matching in the first slice (Phase 3).
- Making Featherbase the system of record for employment facts; StyleHR and
  HR's files stay authoritative, Featherbase resolves identity.
- Aadhaar authentication or offline e-KYC (we are not a requesting entity and
  do not intend to become one).
- Rewriting history columns (`owner`, `modified_by`, Activity Log, Version)
  on merge — see D6.

## Verdict on #371

**Merge it. Its model is the right foundation and nothing in it forces a
second migration of live users.** Sign-in identities keyed by
`(method, subject)` are exactly the "things that can authenticate" layer; the
Sign In Method rows are the authenticating subset of identifier systems; User
as the person record is what every surveyed platform does (research §1). The
tables below are additive: new tables, one nullable column on `user`, one
nullable column on `user_identity`.

Two changes are **recommended inside #371 before merge** because they shape
new data from the first day; neither blocks the merge, and both are small:

| # | Change | Why now | If deferred |
|---|---|---|---|
| M1 | D4 of #371: a person created by a Google sign-in gets an opaque generated id (`usr_` + random), **not** the folded email. Keep the address in `email`. | Every surveyed platform refuses an address as the permanent anchor (Entra: UPN/mail "not selectable" [E1]). `row_id` is the warehouse's `person_id` and appears in every `owner`/`modified_by`; an address there is a future rename, and renames break the mirror. Today's 13 email-id users stay as they are — the rule is forward-only. | A handful of RB/Uday/Zain-class accounts created between the two deploys carry an email id for ever (harmless, untidy) or get renamed (a cascade in Featherbase, a break in the warehouse). |
| M2 | D7 of #371: `user_identity` gains `ended_at timestamptz` + `ended_reason`; a `left` answer **ends that identity** and disables the person **only when no other HR-system identity of theirs is still live**. A person with one employment is disabled exactly as today. | Once one person holds two StyleHR records (the conversion case this change exists for), StyleHR reports `left` for the old record and today's rule would disable the converted employee. | Phase 1 adds the column and the rule anyway; until then an admin re-enables anyone caught by it (a support cost, not a security hole — disabling is the safe direction). |

**Not changed, deliberately:**

- **User stays User; no rename to Person.** A rename touches every
  `reference_table: 'User'`, `data_scope."user"`, the CDC registration
  (`featherbase.user` → `access`), the web app, Tasker, every doc, and the
  platform's own vocabulary (`CONTEXT.md`). Keycloak, Auth0, Okta, SCIM and
  Frappe all call the account record User and reach for a separate "Person"
  only when one human must span several *patient*/*worker* records (FHIR,
  Workday) — which is what identifiers-with-history give us without a second
  table. Spec prose says "a person's account"; the warehouse exposes
  `person_id` as a column name. *Consistency, cheaper.*
- **`user.row_id` = employee code for existing staff stays.** It is an
  accident of the roster sync, not a design; the new rule is only that a User
  id is **never changed after creation** (D1 guard). The codes themselves move
  into identifier rows where they can change, expire and multiply.
- **`user_identity` stays separate from `person_identifier`.** Sign-in rows
  are security-critical and are written only by the sign-in pipeline and the
  admin link endpoints; identifier rows are HR data with wider edit rights.
  One table with a `can_authenticate` flag would put both behind one write
  path and one permission. *Performs better (smaller blast radius) without
  sacrifice.*

## Decisions

### D1. The person is the User; its id is permanent

- `user.row_id` is the person id. A controller refuses any rename of a User
  row (the engine's `on update cascade` stays as safety, never as a feature),
  pinned by a test. *Cheaper than a surrogate column; consistent with every
  existing reference.*
- New column `user.replaced_by varchar(140) null references "user"(row_id)`:
  set on a merged-away record (FHIR `replaced-by`). A record with
  `replaced_by` set is `enabled = false`, cannot sign in, cannot be assigned,
  cannot be chosen in any Reference picker, and resolves to its survivor
  wherever a person is looked up by identifier. It is never deleted.
- New people created by any path get `usr_` + 20 random base32 characters
  unless the caller supplies an id (the roster sync keeps supplying the
  employee code for compatibility until the warehouse follow-up switches it
  off; sign-up keeps the username, which the person chose as their name).

### D2. Identifier System — configuration with shipped defaults

A new system Table **Identifier System** (`featherbase.identifier_system`,
module Core, `system = true`, System Manager only; mirrored). One row = one
namespace of values (FHIR `Identifier.system`). Columns:

| column | meaning | default |
|---|---|---|
| `row_id` (key) | slug, e.g. `stylehr-employee-code` | — |
| `label` | shown in the Identifiers panel | — |
| `kind` | `employee-record` \| `national-id` \| `contact` \| `external-record` | — |
| `normalise` | `trim` \| `lower` \| `upper` \| `digits` \| `indian-mobile` (digits, strip leading 0/+91, require 10) | `trim` |
| `format` | optional regex a value must match after normalising; `aadhaar` adds the Verhoeff check | empty |
| `one_holder_at_a_time` | a *current* value belongs to at most one person | on |
| `one_per_person` | a person holds at most one *current* value | off (on for national ids) |
| `storage` | `plain` \| `fingerprint` (keyed hash + last-4 hint; the value itself is never written) | `plain` |
| `display` | `full` \| `last4` \| `hidden` | `full` |
| `tier` | `basic` \| `restricted` — who may read it (reuses the column-tier model, PERM-006) | `basic` |
| `edited_by` | `source` (only the named sync writes it; humans read) \| `system-manager` \| `hr-roles` (roles listed in `editor_roles`) | `system-manager` |
| `source` | label of the feed that owns it, e.g. `stylehr-roster-sync` | empty |
| `match_policy` | `off` \| `suggest` \| `auto-link` | `suggest` for national ids and contact systems, `off` for codes |
| `assurance` | `weak` \| `strong` — how much a match on it proves (FHIR assurance, collapsed to two) | `weak` |
| `enabled` | off ⇒ hidden from panels, still searchable | on |

Controller rules (validated on save, like Sign In Method's):

- `auto-link` needs `assurance = strong` **and** `one_per_person` **and** no
  Sign In Method whose subject is this system (D7). Otherwise 417 naming the
  rule.
- `storage = fingerprint` requires `display ∈ {last4, hidden}` and
  `tier = restricted`.
- A system that holds identifier rows cannot be deleted (409); disable it.
- A Sign In Method row gains an optional `identifier_system` reference: "my
  subject is a value of this system". The migration sets it for the
  delegated StyleHR row (`stylehr-employee-code`). The password and Google
  methods have no identifier system (a Google `sub` is meaningful only to
  Google; its email is a *contact* identifier, D3).

**Jeyarama defaults, written by migration 0101 (editable afterwards):**

| key | label | kind | normalise | storage / display / tier | one per person | edited by | match |
|---|---|---|---|---|---|---|---|
| `stylehr-employee-code` | StyleHR employee code | employee-record | `upper` | plain / full / basic | no (a person collects codes) | source (`stylehr-roster-sync`) | off — it is a key, not a clue |
| `stylehr-employee-id` | StyleHR record number | external-record | `digits` | plain / hidden / restricted | no | source | off |
| `aadhaar` | Aadhaar | national-id | `digits` + Verhoeff | **fingerprint / last4 / restricted** | yes | source + system-manager | **suggest** |
| `phone` | Mobile phone | contact | `indian-mobile` | plain / full / restricted | no | hr-roles, self | suggest |
| `email` | Email address | contact | `lower` | plain / full / basic | no | self, system-manager | suggest |

"Agency code" is **not** a separate system: in StyleHR an agency worker's code
lives in the same `employee_code` field (bare numeric) and becomes an `old`
identifier on conversion (D4). StyleHR's `existing_emp_code` is written as an
`old` row of `stylehr-employee-code` by the sync. *Consistent with the source;
cheaper than a second namespace.* An administrator may still add
`agency-<name>-code` if an agency's own numbering is ever needed.

### D3. Person Identifier — one row per value a person has or had

Raw platform table `person_identifier` (like `user_identity`: written only
through its controller; the generic save never touches it):

| column | meaning |
|---|---|
| `id` | `pid_` + random |
| `user_id` | → `user.row_id`, `on delete restrict` (a person with identifiers is never deleted) |
| `system` | → `identifier_system.row_id`, `on update cascade on delete restrict` |
| `value` | the normalised value; **NULL when the system's storage is `fingerprint`** |
| `value_fingerprint` | `HMAC-SHA-256(key, normalised value)` hex, for fingerprint systems; NULL otherwise |
| `value_hint` | last 4 characters for `display = last4`; NULL otherwise |
| `use` | `official` \| `usual` \| `old` \| `temp` (FHIR identifier use) |
| `valid_from`, `valid_to` | the period; `valid_to NULL` = current |
| `assigner` | who issued it: a StyleHR firm name, "agency", a Google Workspace domain |
| `source` | `stylehr-roster-sync` \| a user id \| `sign-in` (write-through from `user_identity`, D5) \| `migration` |
| `recorded_at`, `recorded_by` | audit |
| `note` | free text, e.g. "converted 03-Mar-2026" |

Constraints (the database arbitrates):

- `unique (system, coalesce(value, value_fingerprint)) where valid_to is null`
  — enforced only for systems with `one_holder_at_a_time`; a partial unique
  index per system is created by the controller when the flag is on (the
  flag cannot be turned on while current duplicates exist; the save lists
  them). Old (`valid_to` set) rows may repeat: two people may have held the
  same store phone in turn.
- `unique (user_id, system) where valid_to is null and <system.one_per_person>`
  — same mechanism.
- `check ((value is null) <> (value_fingerprint is null))`.

The fingerprint key is `IDENTIFIER_FINGERPRINT_KEY` (server env, 32+ random
bytes, never in the database, never logged). A missing key disables every
`fingerprint` system (their writes answer 503 naming the setting) rather than
falling back to a plain hash. Rotation = re-fingerprinting from the source
feed; the design accepts that cost because the key should never rotate in
normal life. *Performs better than storing the value with no sacrifice we are
allowed to make.*

Reads: the generic APIs return `value` only for `display = full`, the hint
for `last4`, nothing for `hidden`; `tier = restricted` systems are omitted for
users without restricted read on User. Search (`/api/search` and the User list
filter) matches on `value`, on `value_hint` when a user types exactly four
digits of a last4 system, and on the fingerprint when a user with
restricted read types a full value — the typed value is fingerprinted in
memory and discarded.

### D4. History: conversion, rehire, code change, mailbox handover

The time dimension lives on identifier rows, not on the person:

- **Agency → company conversion.** StyleHR creates a new employee record
  (`RR-10353`) for the person who was `21654`. The sync creates a User for the
  new record (today's behaviour), writes its identifiers, and the Aadhaar
  fingerprint matches `21654`'s → a suggestion (D6). On confirmation, the
  merge keeps the newer record's id or the older — survivorship D6 — and the
  other code becomes `use = old, valid_to = conversion date`. Searching
  `21654` finds the person; a report for a month before the conversion still
  attributes `21654`'s sales to them.
- **Rehire.** StyleHR either reactivates the old record (same code: the sync
  clears `valid_to`, `use = official` again, one new `valid_from`; the
  previous period is kept as a closed `old` row) or issues a new code (a new
  official row; the old one stays `old`). Either way the person is one row.
- **Code change inside StyleHR** (a correction): the sync sees a code it does
  not know on a record number it does (`stylehr-employee-id`): it closes the
  old code row and opens the new — no suggestion needed because the record
  number proves identity.
- **Store mailbox** (`sm.atk@jeyarama.com`, a Google account that passes from
  one Store Manager to the next): the Google identity row moves with #371's
  `PATCH /api/identities/:id {user_id}`; this change adds that the move also
  closes the previous holder's `email` identifier row (`valid_to = now`) and
  opens one for the new holder, and that `user_identity` keeps `ended_at` on
  a copy of the old link rather than overwriting it in place — so the audit
  question "who held the mailbox in May?" is a query, not an Activity Log
  read.

### D5. Sign-in identities write through to identifier rows

When `user_identity` gains a row whose method has an `identifier_system`
(StyleHR), the controller writes/updates the matching `person_identifier`
row (`source = sign-in`, `use = official`). When the identity ends
(`ended_at`, D7 of #371 as amended by M2), the identifier row gets
`valid_to`. The identifier row is read-only for humans. The migration
backfills one row per existing StyleHR identity and one per `employee_code`
Custom Field value that has no identity. Google identities write an `email`
identifier row from the verified address they returned (so RB's three Google
accounts show as three emails on one person). *Consistent: one place to
search for a code, at the cost of a derived copy; the sign-in path never reads
the copy.*

### D6. Suggest, review, merge, undo

**Candidate matches.** On every identifier write (sync, manual, write-through)
the controller looks for a *different* person holding the same current value
or fingerprint in the same system, for systems with `match_policy ≠ off`, and
upserts a row in **Person Match** (system Table, mirrored, read by the review
screen):

| column | meaning |
|---|---|
| `row_id` | `pm_` + random |
| `person_a`, `person_b` | the two User ids, ordered so the pair is unique |
| `reasons` | JSON list `[{system, assurance, matched_on: "value" \| "fingerprint", hint}]`, appended as more systems agree |
| `strength` | `strong` if any reason has `assurance = strong`, else `weak` |
| `status` | `open` \| `merged` \| `not-the-same-person` \| `withdrawn` (one side was merged elsewhere) |
| `decided_by`, `decided_at`, `decision_note` | the steward's decision |

`unique (person_a, person_b)`: a pair is raised once; `not-the-same-person`
sticks until a steward reopens it (Reltio "Not a Match" [M3]). A nightly job
re-scans for pairs the write-time check could have missed (e.g. a system
whose policy was turned on later). Phase 1 matches exact normalised values
only; fuzzy name + date-of-birth rules are Phase 3 and will raise `weak`
suggestions only.

**Review list** (`/featherbase/admin/people/duplicates`): open matches,
strongest first, each showing both records side by side — name, codes with
periods, worker type from the roster, roles, Data Scope, sign-in methods,
last sign-in — and the reasons. Actions: *Merge* (opens the preview), *Not the
same person* (with a note), *Later*. The reviewer role is `Data Quality
Manager` (epic #4332 A4) or System Manager; the role is created by the
migration if absent.

**Merge preview and confirm** (`POST /api/people/merge`, single transaction,
also reachable from any User form via "Merge into…"):

1. Survivor = the record with the **live employment** (a current
   `stylehr-employee-code` row), else the most recently signed-in, else the
   older record; the reviewer may swap. *Consistent with StyleHR, which also
   keeps the new employment.*
2. Survivorship, field by field, shown before confirming: `full_name` from
   the survivor unless empty; `email` from the survivor, the other becomes an
   `email` identifier; `language` survivor's; `enabled` = survivor's.
   **Roles = union; Data Scope = union; shares = union; identities =
   all moved** — and the preview lists every role, scope row and sign-in
   method the surviving person *gains*. The reviewer must tick "I have checked
   the access this person gains".
3. **Privilege guard**: if the merged-away record holds Administrator or
   System Manager and the survivor does not, the merge is refused unless the
   reviewer is an Administrator (Entra blocks matches onto privileged
   accounts [E2]). A merge never adds a privileged role silently.
4. Moves, each appended to the merge's move log: `has_role`, `data_scope`,
   `share`, `user_identity`, `person_identifier` (codes → `use = old` only if
   the survivor has a current code in the same system *and* the system is
   `one_per_person`; otherwise both stay official), and every `Reference →
   User` column in every Table the metadata knows (the engine walks
   `column_def where reference_table = 'User'`, so app tables — Section
   Leadership, Store Manager, Tasker assignments — are covered without a
   list). **History columns are not rewritten**: `owner`, `modified_by`,
   Activity Log, Version and Comment keep the old id, which still resolves
   through `replaced_by`. *Cheaper and faster; the audit trail stays true.*
5. The merged-away record: `enabled = false`, `replaced_by = survivor`, its
   sessions end on their next request, its Match rows become `withdrawn`.
6. **Person Merge** row (raw table): `id`, `survivor_id`, `merged_id`,
   `match_id`, `merged_at`, `merged_by`, `survivorship` JSON (field →
   {chosen, other}), `moved` JSON (every row moved: table, row id, column, old
   value), `undone_at`, `undone_by`, `undo_note`. Activity Log rows on both
   persons.

**Undo** (`POST /api/people/merge/:id/undo`): replays `moved` in reverse,
restores the survivorship losers, clears `replaced_by`, re-enables the record
(the reviewer may keep it disabled), and sets the Match to
`not-the-same-person` with the undo note. Rows that were created on the
survivor *after* the merge stay with the survivor and are listed for the
reviewer to move by hand. An undo is itself logged and is possible as long as
the merge is the latest merge either record took part in (a merge chain
undoes from the top; the API says which one is next).

### D7. Auto-link: an opt-in per system that can never touch access

`match_policy = auto-link` means: when an identifier write would create a
**strong** match with exactly one other person, and **neither** record holds
a privileged role or any Data Scope row, and the system is not a sign-in
subject, the merge runs automatically with the default survivorship and a
Person Merge row `merged_by = 'auto-link:<system>'`. Any other condition
downgrades to a suggestion with the reason recorded. So an agency worker
becoming an employee can be joined without a human when the owner turns it on
for `aadhaar`; a Store Manager (who has Data Scope rows) never is. The default
for every shipped system is `suggest` or `off`; the controller refuses
`auto-link` on `phone`, `email` and every code system (D2). *Performs better
only where it cannot sacrifice safety.*

### D8. Aadhaar

- **Never stored, never shown.** Storage `fingerprint`: Featherbase receives
  the number once (over TLS, from the roster sync or typed by a System
  Manager), normalises, checks the Verhoeff digit, computes
  `HMAC-SHA-256(IDENTIFIER_FINGERPRINT_KEY, digits)`, keeps the fingerprint
  and the last four digits, and discards the number. Request bodies for
  fingerprint systems are excluded from request logging; the Activity Log
  records only the hint (`XXXX XXXX 1234`, UIDAI's masked form [L6]).
- **Why a keyed hash and not a plain one:** ~8×10¹⁰ valid numbers make
  SHA-256 reversible by enumeration (research §3). The key lives in the
  server environment, never in the database or the mirror.
- **Why Featherbase fingerprints rather than the sync:** one key holder. The
  alternative — the warehouse computes "records A and B share a national id"
  and sends only the assertion — keeps Aadhaar out of Featherbase entirely but
  makes the warehouse the matcher, duplicates matching logic, and the
  warehouse is the less controlled place (see the flag below). Rejected on
  *consistency*; kept as the fallback if the lawyer says otherwise.
- **Legal basis** (research §3, not legal advice): a private employer may
  collect Aadhaar with informed consent and an offered alternative (Aadhaar
  Act s.4(3), s.4(6) as amended 2019); the Sharing of Information Regulations
  bind everyone to confidentiality, no display, no publication and no
  retention beyond purpose; DPDP s.7(i) covers employment processing with
  s.8 safeguards and erasure. A fingerprint used only to detect duplicates is
  our engineering choice. **UNCERTAIN and for a lawyer:** whether the
  fingerprint counts as "storing" the number; whether an internal screen
  showing the last four digits is "display" (UIDAI's own masked Aadhaar shows
  them, so we assume not); the DPDP Rules commencement date.
- **Flag to the owner (outside this change):** `bronze_stylehr.public.
  employee_employeeidentity` in MotherDuck holds **28,770 full Aadhaar numbers
  in clear**, plus `employee_aadhaarverification.aadhaar_number` (35) and
  `nominee_aadhaar_number`. That is a mirror of a database containing Aadhaar
  numbers held by a service account many agents can reach — the exact thing
  Regulation 6 asks be kept confidential. Recommended: mask or drop those
  columns at the bronze loader, and have the roster sync read the number
  from StyleHR directly for fingerprinting. Filed as a data-warehouse issue
  at close-out.

### D9. Who may edit what

`edited_by` on the system decides: `source` systems are read-only on screens
(the sync owns them; a human correction goes to the source — the settled HR
rule that disagreements go to a review list, never auto-resolved);
`system-manager` as today; `hr-roles` lists roles (default `Data Quality
Manager`) that may add, end or correct a value on anyone; every person may
add or end their own `phone` and `email` (self). Every write is an Activity
Log row on the person with the actor, the system, the hint and the period.

### D10. What the warehouse consumes

- `person_id` = `user.row_id`, immutable (D1), already mirrored at
  `bronze_featherbase.access.user`. A merged-away record keeps flowing with
  `replaced_by` set, so a warehouse join on an old id resolves in one hop.
- CDC registration (`pg_md_cdc/registrations/featherbase.yml`): add
  `identifier_system`, `person_identifier`, `person_match`, `person_merge`
  to `system_tables` routed to the `access` schema; keep `user_identity`
  (#372) denied unless the warehouse needs sign-in facts. `person_identifier`
  carries no Aadhaar number by construction; `phone` is `restricted` and is
  already in bronze_stylehr, so mirroring adds no new exposure.
- Gold (data-warehouse follow-up): `gold.hr.person` (person_id, display
  name, worker type from StyleHR, current codes) and
  `gold.hr.person_identifier` (person_id, system, value, valid_from,
  valid_to) for non-restricted systems; `gold.hr.employee` gains `person_id`
  by joining its StyleHR record number to `stylehr-employee-id`. Reports join
  facts keyed by employee code to `person_identifier` **as of the fact's
  date**, which is what makes last year's `21654` sales land on today's
  `RR-10353`.
- Report scoping inside Featherbase (`sales-target.ts`, epic #4332 C1) reads a
  person's codes from `person_identifier` — current codes for today's
  sections, codes valid in the report period for history — instead of the one
  `employee_code` Custom Field.

### D11. Roster sync (data-warehouse follow-up; do not edit here)

In addition to #371's list: send `stylehr-employee-id`, the current code,
`existing_emp_code` as an `old` row with `valid_to = date_joined` of the new
record, phone, official email, and the Aadhaar number (from StyleHR directly,
not from bronze) for fingerprinting; treat `--disable-leavers` per person —
disable only when **every** StyleHR record linked to the person is
terminated; never create a User for a record whose identifiers already
resolve to a person with `replaced_by` or an open match (list it instead).

### D12. Screens (Admin UI stays generic where it can)

- **Identifier System**: the generic ListView/FormView (invariant 3), with
  the controller's 417s explaining refused combinations.
- **User form → Identifiers panel** (beside #371's Sign-in methods panel):
  rows grouped by system, value or hint, period, source, with add/end for
  editable systems; a "Merge into…" action for reviewers; a banner "This
  record was merged into <survivor>" on a replaced record.
- **Duplicates** (`/featherbase/admin/people/duplicates`): the review list
  (D6) with side-by-side records and the merge preview; a "History" tab lists
  merges with Undo.
- Search results show a replaced record as "→ <survivor>".

## Use cases walked through

1. **Zain** (SM of ATK): User `RR-0421` from the sync (StyleHR identity +
   `stylehr-employee-code` row). He signs in by StyleHR, opens Sign-in
   methods, links his Google account (#371 self-link). The Google identity
   writes an `email` identifier `zain@jeyarama.com`. One record, two ways in,
   three identifiers; the warehouse sees one `person_id`.
2. **RB**: created by Google (`create_if_email_domain_allowed`), id
   `usr_…` (M1). He links his `rct.in` and `theramachandran.com` Google
   accounts himself; each adds an `email` identifier. If IT had created a
   second account for one of those addresses earlier, the `email` match
   suggests the pair; RB or Siraj merges; the loser stays as a `replaced_by`
   record.
3. **`21654` → `RR-10353`**: two Users from the sync; the sync sends both
   Aadhaar numbers; the second fingerprint matches → `strong` suggestion. The
   Data Quality Manager sees "worker type Agency until 02-Mar, Regular from
   03-Mar; same Aadhaar ending 1234; no roles differ", merges with
   `RR-10353` as survivor; `21654` becomes `old` with `valid_to = 02-Mar`.
   Last February's report still finds them.
4. **Two different people**: same `phone` (a shared family number), different
   Aadhaar fingerprints → a `weak` suggestion whose reasons show the
   disagreement; the reviewer marks "not the same person"; the pair is never
   raised again.
5. **Wrong merge**: a reviewer merged two namesakes; a week later a sign-in
   complaint shows it. Undo restores roles, scope, identities and codes from
   the move log, re-enables the record, and lists the two rows added since
   for a hand decision.
6. **Leaver**: StyleHR says `left` for a person with one employment →
   identity ended, person disabled (#371 D7). For a person with two StyleHR
   identities, only the ended one closes (M2).
7. **Rehire**: the sync sees the old record active again → the old code row
   reopens with a new `valid_from`; or a new code arrives on a record whose
   Aadhaar fingerprint matches → suggestion → merge.
8. **Store-manager mailbox**: `sm.atk@jeyarama.com` moves to the new SM with
   #371's move; the old SM's `email` row closes, the new SM's opens; the old
   link keeps `ended_at`.

## Migration (`0101_person_resolution.ts`, idempotent, rehearsable)

1. Identifier System Table + the five Jeyarama rows (D2); `Data Quality
   Manager` role if absent; Person Match Table; `person_identifier` and
   `person_merge` raw tables with their indexes; `user.replaced_by`;
   `user_identity.ended_at`, `ended_reason`; `sign_in_method.identifier_system`
   set on delegated rows.
2. Backfill: one `stylehr-employee-code` row per StyleHR identity subject
   (`source = sign-in`) and per `employee_code` Custom Field value without an
   identity (`source = migration`); one `email` row per Google identity
   email and per `user.email` that is not already a row.
3. A read-only `cli people:plan` prints the backfill and the candidate
   matches it would raise (none are merged by the migration).
4. Rollback: forward-fix; the snapshot before deploy as the backstop.

## Risks / Trade-offs

- **A wrong auto-link grants access.** Bounded by D7: strong key only, no
  privileged or scoped record, never a sign-in subject, off by default, every
  merge undoable.
- **The fingerprint key is a single secret.** Losing it means
  re-fingerprinting from StyleHR; leaking it makes the fingerprints
  enumerable like a plain hash. Mitigation: env-only, rotation procedure
  documented, and the bronze flag (D8) removes the larger exposure.
- **Merge walks every Reference → User column.** On a 277-user instance this
  is milliseconds; the walk is metadata-driven so a new app table is covered
  automatically, and a column the engine cannot update (a bound source) is
  reported, not skipped silently.
- **Two copies of a StyleHR code** (`user_identity.subject` and
  `person_identifier.value`): write-through keeps them equal; a test pins that
  the sign-in path never reads the copy.
- **Reviewer fatigue.** Phase 1 raises only exact matches (2,159 Aadhaar pairs
  at most across all of StyleHR, far fewer among the ~300 Featherbase users);
  Phase 3's fuzzy rules get a cap like Informatica's backlog limit.

## Test plan

Server (Vitest, SQL sandbox):

- `identifier-systems.test.ts` — controller rules (auto-link refused for
  weak/sign-in/phone/email/code; fingerprint needs restricted + last4/hidden;
  cannot delete a used system; one-holder flag refused while duplicates
  exist).
- `person-identifiers.test.ts` — normalisation per rule; Verhoeff; fingerprint
  written, value never written, hint = last 4; one holder at a time; one per
  person; old rows may repeat; display/tier filtering in the generic read;
  search by value/hint/fingerprint; self edits limited to own contact rows;
  source systems read-only for humans; missing key ⇒ 503, no plain-hash
  fallback; request-log redaction.
- `person-matches.test.ts` — suggestion on exact match across two persons;
  reasons accumulate; pair unique; not-the-same-person sticks; withdrawn when
  a side is merged; nightly re-scan finds a pair after a policy change.
- `person-merge.test.ts` — survivor default; preview lists gained access;
  privilege guard; union of roles/scope/shares; identities move; codes become
  old only under one-per-person; every `Reference → User` column repointed;
  history columns untouched; replaced record cannot sign in or be picked;
  sessions end; undo restores everything and lists post-merge rows; chain
  undo order; auto-link runs only under D7's conditions and is logged.
- `sign-in` adaptations — `left` ends one identity and disables only when no
  other HR identity is live (M2); write-through rows on link/unlink/move;
  mailbox move closes and opens `email` rows.
- `migration-0101.test.ts` — dev-shaped fixture: backfill counts, idempotent
  re-run, `people:plan` parity.
- Warehouse (data-warehouse repo): CDC registration validate; gold person
  dimension tests (one row per person_id; every current code maps to exactly
  one person).

Web: Identifiers panel renders by display rule; Duplicates page lists and
decides; merge preview blocks confirm until the access tick; Undo visible on
history. E2E: sync-shaped setup → suggestion → merge → sign in through the
merged-away StyleHR code opens the survivor → undo.

Gates: server and web typecheck, full suites, `pnpm check:specs`,
`git diff --check`.
