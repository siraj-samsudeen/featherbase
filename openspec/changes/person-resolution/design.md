# Design

Revision 4 (22-Oct-2026): round-2 review applied. The structural clean-start
(User → Person, the service-account split, opaque ids with the dev re-id, the
`sign_in_identity` rename) is now its own change, **`person-rename`**, which
this change stacks on. Decisions marked by the coordinator (D-a … D-d, and the
round-2 DECISIONs) are settled.

## Context

Stack: `person-identities` (#371, migration 0100) → `person-rename` (0101) →
**this change (0102)**. From #371: one account per human with several linked
sign-ins keyed by the provider's permanent id; Sign In Method rows; one
pipeline; admin and self linking; lockout guard; leaver rule; audit. From
`person-rename`: the `person` table with opaque `psn_` ids; `service_account`
and the principal model (`principal_kind` + `principal_id` on tokens, Data
Scope, Share, roles); `sign_in_identity`; the handler registry used for the
re-id; `isPrivileged`.

What is still missing: identifiers that do not sign in; a record of two
account records being one person; the time dimension; a review list; merge and
unmerge; what a merge may do to access.

Jeyarama's data (research §4): 2,159 Aadhaar numbers held by 2+ StyleHR
records, 665 spanning an agency → company conversion; 6,803 prior codes in
`existing_emp_code`; phones shared 2,774 times; 28 employee codes collide
across firms, so the StyleHR surrogate record number is the only unique record
key. Dev: ~280 persons, ~40 daily StyleHR sign-ins (the trial; they must keep
signing in). Prod: empty.

Three principles settle every routine choice (owner's decision principles):
**performs better without a major sacrifice · more consistent · cheaper or
faster.**

### Settled decisions

- **D-a. Population.** Phase 1 covers people who **sign in or hold a role**
  (~300, a queue of tens). The whole workforce (~30k) is Phase 2. Until then
  the warehouse resolves `21654 → RR-10353` from StyleHR's `existing_emp_code`.
- **D-b. Auto-link is out of this change** (D7).
- **D-c. #371 merges with only M1.** `ended_at` and the leaver rule land here.
- **Round 2, structure:** `person-rename` (0101) carries C1–C3 and the
  `sign_in_identity` rename; this change (0102) carries identifiers, the C4
  subject rewrite, C5, merge and undo, clusters.
- **Round 2/3, phases:** 1a-i (about a week) · 1a-ii · 1b · 2 · 3 — see
  Phasing. **Round 3 (DECISION):** 0102's Phase 1a-i deploys to dev together
  with `person-rename`'s 0101 in one release; test-mode hardening stays in
  1a-i because test mode resolves through identifiers from that day; the
  record-based leaver rule moves to 1b (it needs the Sync feed); sales-target
  scoping is a separate PR that also drops the `employee_code` Custom Field.
- **Round 2, who is fed:** the warehouse sends the list (TLs, DMs and SMs from
  section ownership plus Store Manager — today's report viewers);
  `create_missing` applies only to that list; everyone else is resolve-only.
- **Round 2, resolve file:** the warehouse produces it (D11).
- **Round 2, observability:** minimal `/api/health` plus structured log lines
  and Activity Log counters; no Prometheus; alerts later via the warehouse's
  daily-loading checks.

## Clean-start decisions kept in this change

| # | Decision | Reason |
|---|---|---|
| C4 | **StyleHR sign-in subject = the StyleHR record number**, not the employee code; `sign_in_name` stays the login. Dev's existing subjects are rewritten from the warehouse's resolve file (D11); an unresolved one **keeps working by employee code until resolved**, flagged, never ended silently. | Only id StyleHR guarantees unique (28 collisions). Trial users must keep signing in. |
| C5 | **The `employee_code` and `stylehr_username` Custom Fields are dropped** in the separate sales-target scoping PR that moves scoping onto identifier rows — the same PR, so the suite never goes red; 1a-i leaves both fields in place. | One home per fact. |
| C6 | **No `use` column**: current = open upper bound. | One fact, one place. |
| C7 | **`person.email` stays** as the primary contact; every address is also an `email` identifier row by write-through. | Mail senders read one column (performance, not compatibility). |
| C8 | No reliance on #371's removed shims (`identity_links`, `.invalid`, pre-upgrade sessions, `social_login`). | They are gone. |
| C9 | Prod: 0100 + 0101 + 0102 as one clean first deploy. | Nothing to keep. |

## Goals / Non-Goals

**Goals:** identifiers with history on one `person`; kind-driven identifier
systems with generic rows plus a Jeyarama seed pack; suggest-then-confirm
groups; reviewed merge with preview, logged moves and deletions, compare-and-set
undo; Aadhaar never stored; a `canonical_person_id` for the warehouse.

**Non-Goals:** auto-link (D7); fuzzy matching (Phase 3); Featherbase as the
system of record for employment; Aadhaar authentication/e-KYC; a
customer-scale party model (`person` is the table of humans who can hold
access); rewriting history columns on **merge** (the re-id in `person-rename`
rewrites them once, by decision).

## Verdict on #371

**Merge it with M1.** Its model is the right foundation; `person-rename` then
applies the structural clean-start; this change is additive on both. The first
draft's M2 is withdrawn (D-c): the corrected leaver rule (D5) needs roster-fed
employment rows that exist only here.

## Decisions

### D1. The person; a replaced record is inert

- `person.row_id` (`psn_…`, from `person-rename`) is the person id; renames
  are refused.
- `person.replaced_by varchar(140) null references person(row_id)` with
  `check (replaced_by is null or not enabled)`. A replaced record cannot sign
  in, cannot be picked or assigned (**Reference pickers exclude replaced and
  built-in records**), resolves to its survivor on identifier lookup; writes
  onto it are **redirected** when the API carries a resolve key (D11) and
  refused 409 `replaced_by` otherwise. Chains are repointed to the final
  survivor on every merge, so the hop is always one.
- `person.built_in` (Administrator, Guest): never merged, replaced or given
  identifiers.

### D2. Identifier System — kind-driven presets, a four-field form, Advanced underneath

System Table **Identifier System** (`identifier_system`, Core, `system = true`,
System Manager only; mirrored). One row = one namespace of values.

**Basic form:** `label`, `kind`, `source`, `match` (Off / Suggest), and
**Sensitivity**:

| Sensitivity | storage | display | tier |
|---|---|---|---|
| Normal | plain | full | basic |
| Restricted | plain | full | restricted |
| **Restricted, hidden** | plain | **hidden** (not shown in panels; searchable by exact value for restricted readers) | restricted |
| Secret | fingerprint | last 4 | restricted |

(The third row answers the review's "hidden in panels" case; `stylehr-employee-id`
uses it. Secret is reserved for values that must never be stored.)

**`kind` drives every other default** (Tableau: detected, labelled, revertible):

| kind | normalise | one holder at a time | one per person | assurance (derived) | match | Sensitivity | edited by |
|---|---|---|---|---|---|---|---|
| `employee-record` | upper | **on**, scoped by assigner | off | weak | Off | Normal | source |
| `external-record` | trim | on | off | weak | Off | Restricted, hidden | source |
| `national-id` | digits (12 + Verhoeff) | **off** | on | **strong** | Suggest | **Secret** | source + System Manager |
| `contact` | indian-mobile (phone) / lower (email) | off | off | weak | Suggest | Normal (phone: Restricted) | self + System Manager |

**Advanced** (collapsed, each with its preset and "revert to default"):
`normalise`, `one_holder_at_a_time`, `one_per_person`, `edited_by`
(`source` / `system-manager` / `reviewers` / `self`), `retain_after_leaving_days`
(Secret only, default 365), `enabled`. Forbidden options are disabled with the
reason. Cut from Phase 1: `format` regex, `editor_roles`, `usual`/`temp`,
per-system DDL. `assurance` is derived from kind, never stored; `match` is the
only matching setting.

Controller rules: **`match ≠ Off ⇒ one_holder_at_a_time = off`** (a matching
system must accept a second holder to raise the group; "one person, one
Aadhaar" is enforced by review); Secret ⇒ its three columns consistent; no
delete while rows exist (409); turning a flag on refused while duplicates
exist; Sign In Method gains `identifier_system` (StyleHR → `stylehr-employee-id`).

**Core ships generic rows:** `phone`, `email`. **Jeyarama seed pack**
`seeds/jeyarama/identifier-systems.json` (`cli seed-pack apply jeyarama`,
idempotent; Phase 1a-i ships `stylehr-employee-id` and `stylehr-employee-code`,
**Phase 1b adds `aadhaar`** with Secret storage):

| key | kind | assigner scope | Sensitivity | match | edited by |
|---|---|---|---|---|---|
| `stylehr-employee-id` | external-record | — | Restricted, hidden | Off | source `stylehr-roster-sync` |
| `stylehr-employee-code` | employee-record | the StyleHR firm | Normal | Off | source |
| `aadhaar` (1b) | national-id | — | Secret | Suggest | source + System Manager |

The seed pack also carries the Jeyarama `people_review` setting (compare
columns incl. `worker_type_from_roster`, survivor rule); core's default has
only generic columns (`full_name`, codes, roles, data scope, sign-in methods,
last sign-in).

### D3. Person Identifier — one row per value a person has or had

Raw table `person_identifier` (controller-written):

| column | meaning |
|---|---|
| `id` | `pid_…` |
| `person_id` | → `person`, `on delete restrict` |
| `system` | → `identifier_system`, `on update cascade on delete restrict` |
| `assigner` | issuer (StyleHR firm, "agency", a Workspace domain); `''` when the system has no assigner scope; part of the key for `employee-record` systems |
| `value` | normalised; **NULL for Secret** |
| `value_hint` | last 4 for Secret |
| `valid` | `daterange` half-open; lower `-infinity` = "before Featherbase knew the person"; upper NULL = current |
| `verified` | source feed / sign-in write-through / System Manager / reviewer ⇒ true; self ⇒ false (never a match reason) |
| `record_identifier_id` | on `employee-record` rows: the `external-record` row (the StyleHR record number) this code belongs to — the leaver rule compares records, not assigners (A-N5) |
| `one_holder`, `one_per_person` | denormalised copies of the system's flags |
| `source`, `recorded_at`, `recorded_by`, `note` | audit |

**Fingerprints live only in** `person_identifier_fingerprint (identifier_id
pk, fingerprint bytea, key_id text, erased_at)`; CDC-denied. **A test asserts
that no mirrored table has a fingerprint-carrying column** (it walks the CDC
registration's selected tables and their columns against a deny-pattern).

Constraints: `create extension if not exists btree_gist` in 0102 (confirm the
managed Postgres offers it — Railway's image does; add to DEPLOY.md);
`exclude using gist (system with =, assigner with =, value with =, valid with
&&) where (one_holder and value is not null)`; `unique (person_id, system)
where upper(valid) is null and one_per_person`; no uniqueness on fingerprints.
Flag changes re-stamp rows; turning on is refused while duplicates exist.

Reads: value for Normal/Restricted (restricted only to restricted readers),
nothing in panels for Restricted-hidden, hint for Secret, never the
fingerprint. Search: value; hint when exactly four digits are typed for a
Secret system; fingerprint when a restricted reader types a full value —
audited (actor, system, hint, time) and rate-limited per actor; the typed
value is discarded. Errors never echo a value. An unchanged write logs nothing.

### D4. History: conversion, rehire, correction, two live employments, mailbox

The sync closes codes; the merge only moves rows.

- **Conversion** (agency → company, different firm): the sync closes `21654`
  (`valid_to` = StyleHR termination), writes `RR-10353` and its Aadhaar; the
  fingerprint matches → strong group; merge moves rows. Last February's report
  still finds `21654`.
- **Same-firm conversion or rehire**: a new StyleHR record in the **same
  firm** (new record number, new or reused code). Liveness is judged per
  record (D5), so the old record's `left` never disables a person whose new
  record is live — whatever the firm.
- **Rehire, same record and code:** the sync opens a new spell (new
  `valid_from` on a closed code opens a new row; the closed one stays).
  **Correction:** the same spell edited (same row, changed bounds or
  assigner) — no new row.
- **Two live employments:** two current code rows, different assigners;
  allowed (`one_per_person` off for codes).
- **Mailbox:** #371's move ends the old `sign_in_identity` row (`moved`),
  inserts the new, closes the old holder's `email` row, opens the new one.

### D5. Sign-in identities: write-through, resolve file, ended identities, leaver rule, test mode

- **Write-through.** A `sign_in_identity` whose method has an
  `identifier_system` writes the matching `person_identifier` row (`source =
  sign-in`, `verified`); ending it closes the row. Google identities write an
  `email` row. Sign-in never reads the copy except dev test mode (below).
- **Subject rewrite to record numbers (C4).** The migration reads the
  **warehouse-produced resolve file** `stylehr_record_ids.csv`
  (`employee_code,assigner,stylehr_record_id`, from `silver_stylehr`; owned by
  data-warehouse#4336, D11) and rewrites each StyleHR subject. A sign-in it
  cannot resolve **keeps its employee-code subject** with
  `subject_kind = 'employee-code'` (default `'record-id'`), stays live, and is
  listed by `people:plan` and on the Person form; the sync's `sign-ins:bulk`
  rewrites it later. Nothing is ended silently.
- **Ended identities.** `ended_at`, `ended_reason` (`left` \| `moved` \|
  `unlinked`); subject and sign-in-name indexes partial `where ended_at is
  null`; `linkedBySubject`, `linkedUser`, `resolveToken` filter on it. An
  ended identity never opens an account; its session ends on the next
  request; unlink ends rather than deletes.
- **Leaver rule (compares records; Phase 1b — it needs the Sync feed's
  employment rows; until then #371's rule stands: `left` disables the
  person).** On `left` for identity I of person P:
  (1) end I; (2) P is **live** iff P has a current, verified, source-fed
  `employee-record` row whose `record_identifier_id` is **a different record**
  from the one I's subject names; (3) live ⇒ P stays enabled; not live, **or
  liveness unknown** (no roster-fed rows) ⇒ disable P as #371 does; (4) the
  sync's `--disable-leavers` applies the same test and remains the backstop.
  **Closing a person's last live employment-record row through the sync
  disables them by this same rule — there is no separate leaver endpoint.**
- **Test mode** (dev only, `DELEGATED_LOGIN_TEST_MODE`): a typed employee code
  is resolved through current `stylehr-employee-code` rows; **refused when it
  resolves to more than one person**; requires a **live, not-ended
  `sign_in_identity` of that method** on the resolved person, then the
  eligibility and privilege checks exactly as with the provider asked. **The
  server refuses to boot with test mode set unless `config.environment`
  (`FEATHERBASE_ENV ?? NODE_ENV ?? 'development'`) is `development` or
  `test`.** This hardening ships in 1a-i (DECISION).

### D6. Groups, review, merge, undo

**Clusters** (raw `person_match`, controller-guarded), one per shared value,
**keyed by `anchor_identifier_id`** — the first identifier row seen holding
the value — never by the value or fingerprint (A-N1 = B-N2). Members in
`person_match_member (match_id, person_id, identifier_id, added_at)`.

| column | meaning |
|---|---|
| `id`, `system`, `assigner`, `anchor_identifier_id` | the group; screens show the value (Normal/Restricted) or the hint (Secret) by reading the anchor row |
| `strength` | **strong** only for `national-id` systems: exactly 2 members, **or** 3+ members every one of whom has employment-record rows and whose periods pairwise do not overlap (an honest agency → company → rehire chain) — a member with **no** employment rows counts as unknown and keeps the group weak; **weak**: anything else, incl. every contact-system group and 3+ overlapping members (a "suspicious group") |
| `status` | `open` \| `deferred` \| `later` (`snoozed_until`) \| `merged` \| `not-the-same-person` \| `withdrawn` |
| `decided_by`, `decided_at`, `decision_note`, `reopened_at`, `reopen_reason` | decisions and reopens |

Rules: raised once per shared verified value; `not-the-same-person` sticks
until **a stronger reason arrives or a new member joins** the decided group
(reopened, reason recorded); reopen endpoint + filter; `later` returns to
`open` after N days (30); a merged-away member ⇒ re-evaluate: **a group of
3+ stays `open` with its remaining members until one member remains, then
`withdrawn`** (its decisions carry to the survivor); matching re-runs on moved
identifiers after merge or undo; **daily cap** on new open groups (default
50) — beyond it groups are `deferred` and **strong ones are promoted first**
the next day; header shows counts; re-scan on `match` change and weekly;
exact values only in 1b, fuzzy in Phase 3.

**Review screen** (1b): open groups strongest first, members side by side on
the configured `people_review` columns and survivor rule; Merge / Not the same
person (note) / Later; header counts; Reopened filter.

**Merge** (`POST /api/people/merge`, `preview=1` first; also "Merge into…" on
any Person form — `match_id` nullable, so RB's accounts merge by hand):

1. Actor: reviewer (`Data Quality Manager`) or System Manager; **never a
   party**; never a `built_in` record; the picker excludes replaced and
   built-in records.
2. Survivor by the configured rule; swappable.
3. Refusals: **different current strong identifiers** — with an **erased
   fingerprint treated as unknown, not different** (so a rehire after erasure
   is not blocked; trade-off: erasure buys privacy at the cost of one lost
   signal, stated in DEPLOY.md) — Administrator override with recorded note;
   **a privileged role the survivor lacks, or any way in (sign-in identity,
   password, or a personal token — tokens are a way in) added to a
   privileged account** — Administrator only; either record replaced — 409.
4. Effective access per table, **gains and losses**; unrestricted vs
   restricted on a table ⇒ reviewer chooses, default narrower; acknowledgement
   tick.
5. Survivorship: `full_name` survivor's unless empty; `email` cleared on the
   loser and kept as an `email` row (restored on undo); `enabled` survivor's,
   loser's recorded. **Pending invite vs linked identity on the same
   address:** the survivor's linked identity wins; the loser's invite is
   cancelled and logged as a deletion.
6. Handler registry walk (from `person-rename`, merge mode): metadata
   References, Dynamic References, raw tables (`has_role` dedupe,
   `data_scope` per 4, `share`, `sign_in_identity` incl. invites,
   `person_identifier`, `access_token` by `principal_id` **under the
   privileged-way-in rule**, `user_settings` dedupe, `saved_view`,
   `password_reset` revoked, `person_match_member`), JSON ids; history columns
   registered "not rewritten"; completeness test; bound-source columns
   reported.
7. Deletions logged; loser left with nothing, `enabled = false`,
   `replaced_by`; chains repointed; matching re-run.
8. Both `person` rows locked `for update` in `row_id` order; refusals
   re-checked inside the lock; **a concurrent merge of either party fails the
   re-check and answers 409 `merge_in_progress`**.
9. `person_merge` row (`moved`, `deleted`, `survivorship`, `scope_choices`,
   `loser_enabled_before`, undo fields, `leftovers` with per-item `handled_by`,
   `handled_at`, `handled_note`); never mirrored. **After confirm:** a result
   summary (rows moved, deleted, access changed), a link to the survivor, and
   an Undo shortcut.

**Undo** (`POST /api/people/merge/:id/undo`, `?preview=1` for a **dry run**
that lists what would revert and what would be left over): compare-and-set
per row; deletions recreated if the key is free; survivorship fields if
unchanged; restores `enabled`, `email`, repoints; leftovers listed with
**"Mark handled" per item (note required)**; blocked when the loser has since
been re-merged or the survivor merged away (named); allowed past unrelated
later merges; does not decide the group; locks in order; logged. **The
confirm text states that an undo cannot itself be redone.** A **global merge
History page** lists merges with Undo, and the replaced-record banner carries
an Undo button.

### D7. Auto-link — deferred (D-b)

Returns later with a second signal (name + DOB, non-overlapping employments,
the value held by exactly two records across all of StyleHR), the
baseline-role gate, off by default, recorded and undoable; flip "clean
conversion" to auto-link once the undo rate has stayed at zero.

### D8. Aadhaar — never stored (Phase 1b)

Secret storage: 12 digits + Verhoeff, `HMAC-SHA-256(key, digits)`, hint =
last 4, the number discarded; request bodies for Secret systems excluded from
logs; Activity Log carries the hint only. Key operations:
`IDENTIFIER_FINGERPRINT_KEY` (env, ≥32 random bytes) with a derived `key_id`
on rows and a key-check value in System Settings; startup check → Secret
systems *degraded* on `/api/health` when absent or mismatched; per-identifier
refusal (`fingerprint_unavailable`); `mode: refingerprint` and `cli
people:fingerprints --status`; never mirrored (own table, CDC-denied, the
mirror test); audited, rate-limited full-value search; **erasure** after
`retain_after_leaving_days` with the hint kept — the **DPDP Act treats the
keyed fingerprint as personal data**, so retention applies; an erased
fingerprint is **unknown**, not different (D6.3); errors never echo values.
Why keyed, why Featherbase holds the key, the legal basis and the UNCERTAIN
points for a lawyer: research §3. **Owner decisions:** direct StyleHR read
access to the Aadhaar table for the sync; the clear-text Aadhaar in
`bronze_stylehr` (28,770 rows) to be masked or dropped.

### D9. Who may change what; roles

`edited_by`: `source` read-only on screens; `system-manager`; `reviewers` =
`Data Quality Manager`; `self` for own contact values (`verified = false`).
**Data Quality Manager:** read the restricted tier on Person and identifiers;
edit reviewer-editable systems; decide groups; merge and undo within D6; no
config writes. **Identity Sync** (generic name): bulk identifiers and sign-ins
on `source` systems, resolve; nothing else. Administrators override A-M5 and
carry privileged roles.

### D10. What the warehouse consumes; report scoping

- Phase 1 population per D-a; prior codes from `existing_emp_code` meanwhile.
- `person_id` immutable; gold exposes **`canonical_person_id`** resolved
  transitively (recursive CTE, cap 10, test that chains ≤ 1); consumers never
  snapshot `person_id`.
- CDC: `identifier_system`, `person_identifier`, `person_match`,
  `person_match_member` in `access`; **deny** `person_identifier_fingerprint`,
  `person_merge`, `sign_in_identity`, `service_account`, `person_id_map`.
- Gold (Phase 2): `gold.hr.person`, `gold.hr.person_identifier` (Normal
  systems); period join as-of the fact date, half-open; within-person overlaps
  resolve to one canonical id; no match ⇒ most recent holder + `period_gap`.
- **Sales-target scoping** (`sales-target.ts`, moved into the same task that
  drops `employee_code`, 1a-i): a person's sections are the union over all
  their **current** codes, matched on **(assigner, code)** when the
  assignment table carries the firm, else on the **record number**; until
  assignments carry the firm, a code currently held by more than one person
  yields `no_assignment` plus a structured-log alert. Period-valid codes:
  Phase 2.

### D11. Sync contract (one page; data-warehouse#4336 cites it)

**Who is fed (DECISION):** the warehouse holds the fed list — today's report
viewers: TLs, DMs and SMs from section ownership plus the Store Manager
table — and **refreshes it on every sync run (daily, with the roster)**.
`create_missing` is **per call**: the warehouse sets it on the call that
carries the fed list and leaves it off for every other row. **A person who
drops off the list changes nothing** in Featherbase: no row is closed, no
access removed; only leavers (below) and explicit role changes do that.

**Inputs the warehouse produces** (data-warehouse#4336):

- **`stylehr_record_ids.csv`** for the one-time subject rewrite (D5) — UTF-8,
  comma-separated, header row, columns `employee_code,assigner,stylehr_record_id`:
  `employee_code` is the code **exactly as StyleHR's employee master stores
  it** (`silver_stylehr.employee.employee_code`, from `employee_employee.
  employee_id`); `assigner` is the **StyleHR company**, `firm_firm.id` of the
  current store × firm posting (`employee_employeestoresandfirms`), carried as
  text; `stylehr_record_id` is `silver_stylehr.employee.employee_key`
  (`employee_employee.id`). Delivered as a file path given to the migration
  command (`cli people:plan --resolve <path>`, DEPLOY.md). A dev person whose
  code matches **2+ rows** (the 28 colliding codes) is **listed for manual
  resolution and keeps working by code**.
- The bulk bodies below, from `silver_stylehr`. **Aadhaar travels as the
  `value` of a row whose `system` is `aadhaar`** — no other field — and only
  once direct StyleHR read access is granted (owner decision).

**Credential:** access token of a `service_account` with role `Identity Sync`.

**`POST /api/people/identifiers:bulk`** — max **500 rows per call**, processed
in body order, **one transaction per row** (a failed row never aborts others).
**`valid_from` is inclusive and `valid_to` is EXCLUSIVE** — half-open, exactly
as stored: a spell that ended on 02-Mar-2026 has `valid_to: "2026-03-03"`.

```json
{ "mode": "upsert", "create_missing": true,
  "rows": [
    { "person": { "system": "stylehr-employee-id", "value": "48213" },
      "person_fields": { "full_name": "A. Kumar", "email": null,
                         "worker_type": "Regular", "firm": "JRPL" },
      "system": "stylehr-employee-id", "value": "48213" },
    { "person": { "system": "stylehr-employee-id", "value": "48213" },
      "system": "stylehr-employee-code", "assigner": "12", "value": "RR-10353",
      "valid_from": "2026-03-03" },
    { "person": { "system": "stylehr-employee-id", "value": "31177" },
      "person_fields": { "full_name": "A. Kumar", "worker_type": "Agency", "firm": "AgencyX" },
      "system": "stylehr-employee-id", "value": "31177" },
    { "person": { "system": "stylehr-employee-id", "value": "31177" },
      "system": "stylehr-employee-code", "assigner": "7", "value": "21654",
      "valid_from": "2024-06-01", "valid_to": "2026-03-03" },
    { "person": { "system": "stylehr-employee-id", "value": "48213" },
      "system": "aadhaar", "value": "<12 digits>" } ] }
```

```json
{ "results": [
    { "row": 0, "result": "created", "person_id": "psn_7k…", "created_person": true },
    { "row": 1, "result": "created", "person_id": "psn_7k…" },
    { "row": 2, "result": "created", "person_id": "psn_3m…", "created_person": true },
    { "row": 3, "result": "created", "person_id": "psn_3m…", "note": "closed spell" },
    { "row": 4, "result": "error", "code": "fingerprint_unavailable" } ],
  "summary": { "created": 4, "updated": 0, "unchanged": 0, "redirected": 0, "error": 1 } }
```

- `person` is a **resolve key**. **`person_fields`** (`full_name`, `email`,
  `worker_type`, `firm`) is used **only when the key creates a person** (it
  sets `full_name`/`email`; `worker_type` and `firm` are recorded in the
  creation note for the review screen); on an existing person it is ignored
  with no error — the roster never overwrites a person's profile. Results:
  `created` (a new row; also `created_person: true` when the key made a
  person) · `updated` · **`unchanged`** (same value, same bounds, same
  assigner, same flags — nothing written, no log) · `redirected` (the key
  hit a replaced record; the write went to the survivor, `person_id` is the
  survivor) · `error` with `code` ∈ `not_found` (key resolves to nobody and
  `create_missing` is false) · `ambiguous` (key resolves to several persons
  — never guessed) · `fingerprint_unavailable` · `invalid_format` · `overlap`
  (exclusion constraint) · `system_disabled` · `not_allowed`.
- **Roles and section assignment** are not identifiers: the sync grants the
  `Sales Target Viewer` role and Data Scope through the renamed principal
  endpoints — `POST /api/people/:id/roles` and `POST /api/people/:id/scope`
  (`{principal_kind: "person", …}`; the service-account twins are
  `/api/service-accounts/:id/roles|scope`).
- **Rehire vs correction:** a row for a code whose latest spell is **closed**
  and whose `valid_from` is after that spell's end **opens a new spell**; a
  row whose `valid_from` falls inside an existing spell **corrects that spell**
  (bounds/assigner). `valid_to` set on a current spell **closes it**.
- **Leaver:** closing a person's **last live employment-record row** disables
  them through the leaver rule (D5). No separate endpoint.
- **`existing_emp_code` overlap with the person's own record** (StyleHR's
  prior-code field names a code another record of the same person holds —
  the conversion signal): send it as a closed `stylehr-employee-code` row on
  the *new* record's person with `note: "existing_emp_code"`; if that code is
  currently held by **another** person, the exclusion refuses it with
  `overlap`, the sync logs it, and the shared Aadhaar raises the group (1b) —
  the sync never merges.
- **Adopting dev rows written with `assigner ''`** (the migration's backfill):
  a row with the same system and value and `assigner ''` is **adopted** —
  its assigner is set, result `updated`, note `assigner adopted` — not
  duplicated.
- **`create_missing` with a duplicate hint:** when the key resolves to nobody
  but **another identifier in the same batch** (e.g. the Aadhaar) matches an
  existing person, the person is still created and the result carries
  `warning: "possible_duplicate"` with that person id; the group follows in
  1b.
- **`mode: refingerprint`:** Secret rows only, for the given `key_id`.

**`POST /api/people/sign-ins:bulk`** — same envelope; rows `{person: <key>,
method: "stylehr", subject: "<record id>", sign_in_name}`. **Never creates a
person** (`not_found` when the key resolves to nobody). Rewrites an
`employee-code` subject to the record id (`updated`, note `subject
resolved`). **Subject already linked to an ended identity:** a live link is
created for the resolved person and the ended row stays as history
(`created`, note `relinked after end`) — unless the ended identity's person
is a *different* person than the key resolves to and that person is not
replaced by this one, in which case the row answers `error` `conflict` and
is listed for review (the record number should never move between living
persons).

**`POST /api/people/resolve`** (read-only) — `{keys: [...]}` →
`[{key, person_id, canonical_person_id, replaced}]`; `not_found`/`ambiguous`
per key.

### D12. Screens

Identifier System (generic FormView, basic/Advanced, Sensitivity computed);
Person form → Identifiers panel (grouped, display rule, period, source,
verified, add/end, "Merge into…", banners for replaced [with Undo] and
leftovers); Duplicates (1b); merge preview and result summary; global merge
History with Undo and leftovers; search shows "→ survivor".

### D13. Observability (minimal, in scope)

- **`/api/health`** (System Manager; also the existing `/api/ping` stays):
  `fingerprint_key_ok`, Secret systems degraded list, `open_groups`,
  `deferred_groups`, `reopened_groups`, `replaced_chain_max_length`, last run
  and status of the re-scan, erasure and snooze jobs.
- **Metrics as structured log lines** (`event=people.merge by=reviewer`,
  `event=identifier.write system=… result=…`, `event=fingerprint.lookup`,
  `event=scoping.ambiguous_code code=…`) and **Activity Log counters** the
  warehouse can count (merge, undo, erasure, lookup).
- Alerts: none in Featherbase; the warehouse's daily-loading checks read
  `/api/health` and the mirrored Activity Log later (key degraded, undo rate,
  deferred groups for 3 days, chain > 1, sync error rate).

## Phasing

- **1a-i (about a week; deploys with `person-rename` 0101 in one release):**
  Identifier System with generic rows + the seed pack (`stylehr-*`); Person
  Identifier with history (`record_identifier_id`, exclusion, btree_gist);
  write-through; the dev data migration (code rows, subject rewrite from the
  resolve file with unresolved and colliding codes kept working by code);
  ended identities; **test-mode hardening** (ambiguous refused, live identity
  required, boot refused outside development/test); the Identifiers panel.
  The `employee_code` and `stylehr_username` Custom Fields stay.
- **Sales-target scoping — a separate PR** right after 1a-i: scoping on
  identifier rows ((assigner, code) or record number, several codes,
  ambiguous ⇒ `no_assignment`) **and** the drop of both Custom Fields, so the
  suite never goes red.
- **1a-ii:** manual merge and undo with the registry (merge mode), preview
  with gains/losses, result summary, dry-run undo, leftovers with Mark
  handled, global History, Undo on the banner.
- **1b:** Secret storage and key operations, `aadhaar` seed row, Sync API v1
  (`identifiers:bulk`, `sign-ins:bulk`, `resolve`), **the record-based leaver
  rule** (replacing #371's until then), clusters, review screen,
  `/api/health`, jobs. **Exit criteria** include the day-one alert in place:
  the warehouse's daily-loading check reads `/api/health` and raises
  **"fingerprint key degraded"** (`fingerprint_key_ok = 0` or any Secret
  system degraded) on the morning rollup, plus the post-deploy counts.
- **2:** workforce population, lanes and bulk confirm, gold person +
  `canonical_person_id`, period-valid scoping (#4332 C1), auto-link (D7).
- **3:** fuzzy name + DOB, per-field survivorship.

## Migration (`0102_person_resolution.ts`, stacked on 0101)

`create extension if not exists btree_gist`; Identifier System Table + generic
rows; roles `Data Quality Manager`, `Identity Sync`; `person_identifier`,
`person_identifier_fingerprint`, `person_match`, `person_match_member`,
`person_merge`; `person.replaced_by` + check, `built_in`;
`sign_in_identity.ended_at`, `ended_reason`, `subject_kind`, partial unique
indexes; `sign_in_method.identifier_system`; core `people_review` default.
Data (dev): code rows from the `employee_code` Custom Field (`assigner ''`),
`record_identifier_id` and subjects from `stylehr_record_ids.csv`, unresolved
listed and kept; `email` rows; drop the two Custom Fields together with the
scoping switch. `cli people:plan` prints all of it; nothing is merged.

**DEPLOY.md order:** 0100 and 0101 live → warehouse delivers
`stylehr_record_ids.csv` → `people:plan`, snapshot → (1b) generate
`IDENTIFIER_FINGERPRINT_KEY`, back it up offline → deploy (0102; btree_gist
confirmed) → `cli seed-pack apply jeyarama` → sync run → post-deploy counts
(rows per system, unresolved sign-ins, open groups, `fingerprint_key_ok`,
chain length 0, Custom Fields gone). Rollback: forward-fix; snapshot backstop.

## Risks / Trade-offs

Single fingerprint key (env-only, key id, offline backup, refingerprint
mode); second Aadhaar holder accepted by design (review enforces, health
shows); registry completeness rests on its test; erasure removes a rehire
signal (erased = unknown); the resolve file is a one-time dependency on the
warehouse (unresolved sign-ins keep working, so it is not a go-live blocker).

## Test plan

`identifier-systems.test.ts` (presets, Sensitivity incl. Restricted-hidden,
`match ≠ Off ⇒ one_holder off` with second holder accepted, Secret
consistency, delete/flag refusals, seed pack idempotent);
`person-identifiers.test.ts` (normalisation, Verhoeff, fingerprint table only,
**mirror test**, half-open periods, exclusion by assigner, `record_identifier_id`,
verified, display/tier incl. hidden, search audit + rate limit, unchanged
writes silent, key missing ⇒ per-row refusal + health, erasure, errors carry
no value); `person-matches.test.ts` (anchor-keyed groups, strong rules incl.
non-overlapping chain, weak suspicious group, sticky + reopen on stronger
reason **and on new member**, later, withdrawn, carry, re-run, cap with strong
first); `person-merge.test.ts` (survivor rule, gains/losses, refusals incl.
party, privileged way-in incl. token, erased = unknown, invite vs identity,
registry + completeness, deletions, chains, locks + **concurrent merge 409**,
result summary, undo dry-run, compare-and-set leftover after an edit, mark
handled, blocked/allowed rules, cannot redo); sign-in (ended never opens;
subject rewrite with unresolved kept working; leaver by record incl. same-firm
conversion; test mode ambiguous refused, live identity required, production
boot refused); `sync-api.test.ts` (every result and error code, rehire vs
correction, unchanged, adopt `''`, duplicate warning, leaver via closing,
500-row cap, per-row transactions, refingerprint, sign-ins, resolve);
`sales-target.test.ts` (several current codes, ambiguous ⇒ `no_assignment` +
log); `migration-0102.test.ts` (dev fixture, resolve file, idempotent, plan
parity, btree_gist). Web: panels, Duplicates, preview, History, banners.
E2E: set-up → group → merge → merged-away login opens survivor → undo → ended
identity refused. Gates: typecheck, suites, `pnpm check:specs`, `git diff --check`.
