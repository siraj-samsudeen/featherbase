# Proposal

## Why

One real person shows up in several places under several names. Zain, the
Store Manager of ATK, has a StyleHR login and a Google account. RB, the CEO,
has Google accounts on several group domains. A sales assistant who started
through an agency has a bare number for an employee code (`21654`); when the
company hires them directly they get a new record and a new code
(`RR-10353`). Each system is right about its own record, and nobody can say
"this is one person" — reports count them twice, access is granted twice, and
a leaver's history splits across records.

The data says this is the normal case, not the exception (StyleHR production,
mirrored in the warehouse, 22-Oct-2026): 30,559 employee records carry 28,770
valid Aadhaar numbers, of which only 26,349 are distinct. **2,159 Aadhaar
numbers are held by two or more employee records — 4,580 records in all, one
number by 17 records — and 665 of those groups span a change of worker type,
the agency-to-company conversion.** 6,803 records carry a prior employee code.
Phone numbers are a weaker clue: 2,774 numbers are shared by 6,196 records, so
a phone can suggest a match but must never decide one.

Change `person-identities` (PR #371) gives one account several ways to sign
in. It says nothing about identifiers that do not sign in (an old employee
code, a national ID, a phone), about two account records that turn out to be
the same person, or about keeping the past searchable. The owner's requirement
(Siraj, 22-Oct-2026): *"Featherbase is a place where we can link all these
identities as one person, no matter which login they are using. We should be
able to say: here is only one person"* — flexible, with sensible defaults,
easy to configure, "exactly like Tableau".

## What Changes

- **Identifier systems are configuration.** An administrator sees which kinds
  of identifier Featherbase knows — employee code, national ID, phone, extra
  email, another system's record number — and for each one: how it is
  normalised, whether one value may belong to only one person at a time,
  how it is shown (in full, last digits only, or not at all), who may read and
  edit it, and whether a match on it may *suggest* or *decide* that two
  records are one person. Jeyarama's set ships pre-configured.
- **A person keeps every identifier they ever had**, each with when it was
  valid and where it came from, so an old agency code still finds the person
  and still works in last year's reports.
- **Possible duplicates become groups to review**, not silent merges. The
  same Aadhaar, phone or email on several records raises one group in a
  review list. A reviewer confirms, marks "not the same person" (which
  sticks until a stronger reason arrives), or sets it aside.
- **Merging two records keeps both and can be undone.** The merged-away record
  stays, inactive, pointing at the survivor; everything moved or removed is
  logged so one action puts back what has not changed since. A merge can also
  be done by hand when two records share no identifier.
- **A merge never quietly widens or narrows access.** The reviewer sees, table
  by table, what the surviving person would gain and lose before confirming;
  privileged access cannot arrive by merge, and two records with different
  national IDs are not merged without an Administrator's recorded override.
- **Automatic linking is deferred** to a later phase; this change ships
  suggest-and-confirm only.
- **Aadhaar is never stored.** Featherbase keeps a keyed fingerprint for
  duplicate detection and the last four digits for display, with the key
  outside the database and operational controls around it.
- **Clean start, no backward compatibility** (owner, 22-Oct-2026). The
  structural part — the human's record is called **Person**, service accounts
  get their own table, every person gets an opaque permanent id, the sign-in
  table is renamed — is its own change, `person-rename`, which this one
  stacks on. Here: HR sign-ins are keyed by the HR record number (a trial
  user's link keeps working by code until the roster supplies it), and the
  code Custom Fields are dropped in the same step that moves report scoping
  onto identifiers.
- **Builds on #371.** A leaver notice from the HR system closes *that* way in
  and disables the person unless the roster shows another current employment;
  an ended way in never opens an account again.
- **The warehouse gets one stable person id**, resolved to its final survivor,
  plus every code that has ever mapped to it and when.

## Capabilities

### New Capabilities

- `people-and-identifiers`: one record per person; identifier systems and
  their defaults; identifiers with history; duplicate groups and the review
  list; merge, survivorship and undo; who may edit; what reports see.

### Modified Capabilities

- `sign-in-and-accounts`: the leaver rule judges employment from the roster;
  an ended sign-in method never opens an account; a moved sign-in method keeps
  its history; an account's permanent id is never an address or a code.

## Impact

- `apps/server`: one new system Table (Identifier System); raw tables
  `person_identifier`, `person_identifier_fingerprint`, `person_match`,
  `person_match_member`, `person_merge`; `person.replaced_by`/`built_in`;
  `sign_in_identity.ended_at`/`subject_kind`; controllers for identifier
  writes, matching, merge and undo; the sync API; a minimal `/api/health`;
  migration `0102` (stacked on `person-rename`'s `0101`) with a one-time data
  migration of dev from the warehouse's record-number file.
- `apps/web`: an Identifiers panel on the Person form, a Duplicates review
  page, a merge preview, an Identifier System form (generic, basic/Advanced).
- Outside the repo: the data-warehouse roster sync is rewritten against the
  sync API (prior codes, phone, Aadhaar for fingerprinting, leavers per
  person; data-warehouse#4336); the CDC registration declares and denies the
  new tables; `gold.hr` gains a person dimension in Phase 2. **The warehouse's
  bronze copy of StyleHR already holds 28,770 full Aadhaar numbers in clear**;
  that exposure predates this change and is flagged to the owner (design D8).
- `research.md` in this change records the sources behind each decision.
