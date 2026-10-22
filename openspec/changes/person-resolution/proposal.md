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
- **Possible duplicates become suggestions**, not silent merges. The same
  Aadhaar on two records, the same phone, the same email: each creates a
  suggestion in a review list. A reviewer confirms or marks "not the same
  person", and that decision sticks.
- **Merging two records keeps both and can be undone.** The merged-away record
  stays, inactive, pointing at the survivor; everything moved is logged so one
  action puts it back.
- **A merge never quietly widens access.** The reviewer sees what access the
  surviving person would gain before confirming, and privileged access cannot
  be gained by a merge.
- **Automatic linking is an opt-in per identifier system, off by default**,
  refused outright for anything that can sign in, and downgraded to a
  suggestion whenever either record holds privileged or scoped access.
- **Aadhaar is never stored.** Featherbase keeps a keyed fingerprint for
  duplicate detection and the last four digits for display, and shows no more.
- **Builds on #371.** Sign-in identities stay as they are. Two small changes to
  its behaviour: a leaver notice from the HR system closes *that* way in and
  disables the person only when no other employment is live; and a person
  created from a Google sign-in gets a permanent id that is not their address.
- **The warehouse gets one stable person id** that survives merges and code
  changes, plus the list of every code that has ever mapped to it.

## Capabilities

### New Capabilities

- `people-and-identifiers`: one record per person; identifier systems and
  their defaults; identifiers with history; suggested matches and the review
  list; merge, survivorship and undo; auto-link policy; what reports see.

### Modified Capabilities

- `sign-in-and-accounts`: the leaver rule becomes per employment; a moved
  sign-in method keeps its history; an account's permanent id is never an
  address or a code.

## Impact

- `apps/server`: two new system Tables (Identifier System, Person Match), two
  new raw platform tables (`person_identifier`, `person_merge`), one new column
  on `user` (`replaced_by`) and one on `user_identity` (`ended_at`), a
  controller for identifier writes and merges, a background matcher, the
  review-list and merge endpoints; migration `0101`.
- `apps/web`: an Identifiers panel on the User form, a Duplicates review page,
  a merge preview, and an Identifier System form (rendered generically).
- Outside the repo: the data-warehouse roster sync sends identifiers (prior
  codes, phone, Aadhaar for fingerprinting) and judges leavers per person; the
  CDC registration declares the new tables; `gold.hr` gains a person
  dimension. **The warehouse's bronze copy of StyleHR already holds 28,770 full
  Aadhaar numbers in clear**; that exposure predates this change and is flagged
  to the owner (design §Aadhaar).
- `research.md` in this change records the sources behind each decision.
