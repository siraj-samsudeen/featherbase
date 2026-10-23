# People and Identifiers

## Purpose

One real person is known by many names: an employee code from each spell of
employment, a national ID, a phone number, several email addresses, a record
number in another system. Featherbase keeps one record for the person, attaches
every identifier they have ever had to it, points out when several records look
like one person, lets a reviewer confirm or refuse, and can undo a merge.
Reports and other systems see one stable person.

## ADDED Requirements

### Requirement: One record for one person

A person SHALL have one record in Featherbase whatever they are called
elsewhere. Every identifier they have or have had — an employee code, a
national ID, a phone number, an email address, another system's record number —
is attached to that one record, and every way they sign in opens it.

#### Scenario: A store manager with an HR login and a Google account

- **WHEN** a Store Manager signs in with their HR system ID on one day and
  with their Google account on another
- **THEN** both open the same record, which lists the HR employee code and
  the Google address among the person's identifiers

#### Scenario: The CEO with three Google accounts

- **WHEN** the CEO links Google accounts from three group domains to their
  record
- **THEN** there is still one record, listing all three addresses, and each
  account opens it

#### Scenario: A record that holds identifiers is not deleted

- **WHEN** an administrator tries to delete a person who has identifiers
  recorded
- **THEN** the delete is refused with the advice to end the identifiers or
  disable the person, and nothing is removed

#### Scenario: A merged-away record names its survivor

- **WHEN** someone opens a record that was merged into another
- **THEN** the record says it was merged into that person by name, never by an
  internal reference, and offers no changes

### Requirement: Identifier systems are set up once, with sensible defaults

An administrator SHALL be able to define each kind of identifier Featherbase
knows by giving it a name, a kind, where its values come from and whether a
shared value should point out possible duplicates; the kind fills in every
other setting — how values are tidied, whether a value belongs to one person
at a time, how much of it is shown and who may see or edit it — and each can
be changed under advanced settings and reverted to its default. Generic kinds
ship with Featherbase; the organisation's own systems arrive as a ready-made
set, so the usual case needs no set-up.

#### Scenario: The shipped set covers a new instance

- **WHEN** an administrator opens a fresh instance with the organisation's set
  applied
- **THEN** the HR employee code, the HR record number, mobile phone and email
  address are already defined, and Aadhaar joins them once fingerprinting is
  switched on, set to be shown by its last four digits only

#### Scenario: A setting that would defeat duplicate detection is refused

- **WHEN** an administrator asks an identifier that points out duplicates to
  also allow only one holder of each value at a time
- **THEN** the change is refused with the explanation that a second holder
  must be accepted so the duplicate can be pointed out

### Requirement: Every identifier a person has had is kept and searchable

A person's identifiers SHALL be kept with the period each was valid and where
it came from. An old identifier still finds the person and still applies to
the time it was valid. A person may hold two current employee codes at once,
for example on two companies' payrolls.

#### Scenario: An agency code that became a company code

- **WHEN** a sales assistant who started through an agency as 21654 is later
  hired directly as RR-10353, the HR roster closes 21654 on the day the agency
  spell ended, and the two records are confirmed as one person
- **THEN** searching 21654 finds them, their record shows 21654 valid until
  that day and RR-10353 as current, and a report for a month before the
  conversion still counts 21654's sales as theirs

#### Scenario: Two live employments

- **WHEN** the HR roster reports the same person as current on two companies'
  payrolls with two codes
- **THEN** the record shows both codes as current, each with its company

#### Scenario: A rehire

- **WHEN** someone who left returns and the HR system reactivates their old
  code
- **THEN** their record shows the code as current again with the new start
  date, and the earlier spell is kept as history

### Requirement: Sensitive identifiers are never shown in full

A national ID such as Aadhaar SHALL never be stored or shown in full.
Featherbase keeps only a keyed fingerprint, used to detect that two records
carry the same number, and the last four digits, which is all anyone sees.
When the fingerprint key is missing or wrong, such identifiers are refused one
by one and the health page says so; nothing weaker is ever stored. Identifiers
marked restricted are visible only to people allowed to see restricted data,
and some are kept out of sight altogether and found only by searching for the
exact value.

#### Scenario: Aadhaar on a person's record

- **WHEN** an administrator opens a store assistant's record
- **THEN** the Aadhaar line shows only its last four digits, and the full
  number cannot be retrieved from Featherbase by anyone

#### Scenario: A phone number for someone without restricted access

- **WHEN** a person who may not see restricted data opens the same record
- **THEN** the phone number and the Aadhaar line are not shown at all

#### Scenario: The fingerprint key is missing

- **WHEN** the roster sends a batch of codes and Aadhaar numbers while the
  fingerprint key is not configured
- **THEN** every code is saved, every Aadhaar row is refused with a reason, and
  the health page reports fingerprinting as unavailable

### Requirement: Possible duplicates are pointed out as groups, a reviewer decides

When a value that counts as a clue — a fingerprinted national ID, a phone, an
email — is held by two or more records, Featherbase SHALL raise one group in a
review list rather than merge anything. A group is strong only for a national
ID: when two records share one, or when several records share one and every
one of them has known employment dates that never overlapped; any other group
— a shared phone or email, several records on one value at the same time, or a
record whose employment is unknown — is weak. A reviewer sees the records side
by side with the reasons and confirms they are one person, marks them as
different people, or sets the group aside for later. "Different people" sticks
for that group until a stronger reason arrives or another record joins it. A
group of several records stays open as its members are merged, until one
remains. Values a person entered about themselves never raise a group.

#### Scenario: Same Aadhaar on two employee records

- **WHEN** the roster brings in RR-10353 whose Aadhaar fingerprint equals the
  one already on 21654's record
- **THEN** a strong group of the two records appears in the review list,
  showing their worker types and dates and the matching last four digits

#### Scenario: Same phone, different people

- **WHEN** two records share a current phone number but show different Aadhaar
  endings, and the reviewer marks them as different people
- **THEN** both records keep their phone number as current and the group does
  not come back when the roster brings the same phone again

#### Scenario: A stronger reason arrives

- **WHEN** a group that was marked as different people on a shared phone later
  turns out to share an Aadhaar fingerprint
- **THEN** a strong group is raised and the earlier decision is reopened,
  noting why

#### Scenario: A third record joins a decided group

- **WHEN** a group marked as different people gains a new record holding the
  same value
- **THEN** the group is reopened, noting the new record as the reason

#### Scenario: An honest chain of three

- **WHEN** three employee records — agency, then company, then a rehire —
  share one Aadhaar fingerprint and their employment periods never overlap
- **THEN** the review list shows one strong group of the three

#### Scenario: One phone on seventeen records

- **WHEN** seventeen current records carry the same phone number
- **THEN** the review list shows one weak group, not many pairs, with a note
  that the value may be a shared or placeholder number

### Requirement: Merging two records keeps everything and can be undone

Confirming that two records are one person SHALL merge them into one
surviving record: roles, data access, sign-in methods, access tokens,
identifiers and every place the other record was referred to move to the
survivor; anything that would be duplicated is recorded before it is removed.
The merged-away record is kept, inactive, pointing at the survivor; nothing is
deleted. A record can also be merged by hand when the two share no identifier.
After confirming, the reviewer sees what moved, a link to the survivor and a
way to undo. One action undoes a merge, putting back exactly what has not
changed since; what has changed is listed for the reviewer to mark as handled,
and an undo can be previewed first. An undo cannot itself be undone, and is
refused while a later merge still builds on this one, and says which.

#### Scenario: Conversion confirmed

- **WHEN** a reviewer confirms that 21654 and RR-10353 are one person
- **THEN** RR-10353's record survives with both codes, both sign-in methods
  and the union of their access; 21654's record stays, inactive, and opening
  it leads to the survivor

#### Scenario: The CEO's second account merged by hand

- **WHEN** an Administrator opens an account IT once made for one of the
  CEO's addresses, which shares no identifier with the CEO's record, and
  merges it into the CEO's record
- **THEN** the preview shows what the CEO's record would gain, and after
  confirming there is one record

#### Scenario: A wrong merge undone

- **WHEN** a reviewer merged two namesakes a week ago and now undoes it
- **THEN** each record gets back its own roles, access, sign-in methods and
  codes as they stood, the merged-away record is active again if it was
  before, and the two rows added to the survivor since are shown for a hand
  decision

#### Scenario: A row changed after the merge

- **WHEN** a role that the merge moved to the survivor was later changed by
  an administrator, and the merge is undone
- **THEN** that role is not moved back; it is listed as left over, and the
  reviewer marks it handled with a note once dealt with

#### Scenario: Undo blocked by a later merge

- **WHEN** the survivor of that merge was later merged into a third record and
  a reviewer tries to undo the first merge
- **THEN** the undo is refused and names the later merge that must be undone
  first

#### Scenario: Two reviewers merge the same record at once

- **WHEN** two reviewers confirm merges involving the same record within the
  same moment
- **THEN** one merge completes and the other is refused with a message that
  the record is being merged; nothing is applied twice

### Requirement: A merge never quietly widens or narrows access

Before a merge is confirmed, Featherbase SHALL show the reviewer, table by
table, every role, data access and way in the surviving person would gain
and lose, and require them to acknowledge it. Where one record could see
everything in a table and the other only part, the reviewer chooses, and the
narrower access is the default. A merge is refused when the two records carry
different national IDs (an erased one counts as unknown, not different), when
it would give someone a privileged role, when it would add a way in — a
sign-in method, a password or an access token — to a privileged account, or
when the reviewer is one of the two people; an Administrator may override the
first with a recorded note and may carry a privileged role across.

#### Scenario: A reviewer sees what the survivor gains and loses

- **WHEN** a Data Quality Manager merges a Team Leader's old record into their
  current one, where the old record still carries access to another store and
  the current one could see every store
- **THEN** the preview lists the other store as a gain and the loss of
  seeing every store, defaults to the narrower access, and waits for the
  reviewer to choose and acknowledge

#### Scenario: Different national IDs

- **WHEN** a reviewer tries to merge two records whose Aadhaar fingerprints
  differ
- **THEN** the merge is refused, and only an Administrator can proceed, with a
  note that is kept

#### Scenario: Privileged access cannot arrive by merge

- **WHEN** a Data Quality Manager tries to merge a record that holds System
  Manager into one that does not
- **THEN** the merge is refused and names the role that only an Administrator
  may carry across

#### Scenario: A way in added to a privileged account

- **WHEN** a Data Quality Manager tries to merge a record that has a password
  and an access token into a System Manager's record
- **THEN** the merge is refused, because only an Administrator may add a way
  in to a privileged account

#### Scenario: A reviewer who is one of the two

- **WHEN** a Data Quality Manager tries to merge another record into their own
- **THEN** the merge is refused and must be done by someone else

### Requirement: Who may change an identifier

Each identifier system SHALL say who may add, end or correct its values: the
system that feeds it (then people can only read it), System Managers,
reviewers, or the person themselves for their own contact details. A value fed
by another system is corrected there, not in Featherbase. Every real change
records who made it and when; saving a value unchanged records nothing.

Until the HR roster feed has written its first code, the employee codes
are frozen at what the upgrade carried over. Meanwhile a System Manager may
record a joiner's code or end a wrong one by hand, always with a note saying
why; such a value is marked not verified, still signs the person in during a
trial, and a carried-over value is ended rather than erased. The hand path
closes by itself once the feed writes. The HR record number is never entered
by hand. When the feed starts, it reconciles each value recorded by hand:
it adopts one that the roster confirms, and lists the rest for a System
Manager, never ending one silently.
Until the sales report reads codes from these values directly, each change
to a person's current employee code also updates the code the report uses,
at the same moment.

A value that only mirrored a sign-in or the person's own email address is
taken over when someone records the same value independently, so removing
the sign-in or changing the address no longer ends it.

#### Scenario: A code from the HR system

- **WHEN** a System Manager tries to edit an employee code that the HR roster
  feeds
- **THEN** they are told the code comes from the HR system and is corrected
  there

#### Scenario: A joiner before the roster feed runs

- **WHEN** HR mails a joiner's employee code and the roster feed has not yet
  written any code
- **THEN** a System Manager records it on the joiner's record with a note, it
  shows as recorded by hand and not verified, and the joiner can sign in by it
  during the trial

#### Scenario: A wrong code before the roster feed runs

- **WHEN** a carried-over employee code turns out to be wrong
- **THEN** a System Manager ends it with a note and records the right one;
  the wrong one stays as history and cannot be erased

#### Scenario: A joiner's Sections follow their code

- **WHEN** a System Manager records a joiner's employee code by hand, and
  later moves a mistaken code from one person to another
- **THEN** the joiner's sales report opens on their Sections at once, and
  after the correction only the right person sees the Sections of that code

#### Scenario: An address recorded by hand outlives the sign-in it mirrored

- **WHEN** a System Manager records an address that a Google sign-in had
  already written, and the sign-in is later removed
- **THEN** the address stays current, because someone recorded it on purpose

#### Scenario: A person updates their own phone

- **WHEN** a Team Leader adds a new mobile number to their own record
- **THEN** the number is saved with today as its start date, the earlier
  number is kept as history, and the new number is not used to point out
  duplicates until the roster confirms it

### Requirement: Reports see one stable person

Every record SHALL carry a permanent person identity that never changes
through merges, code changes or new employments, and the warehouse receives it
together with every code that has ever mapped to it and when. A merged-away
record keeps pointing at its final survivor so an old reference resolves in
one step. A report that scopes by employee code finds a person by all their
current codes, and refuses to guess when a code is held by more than one
person.

#### Scenario: Last year's sales under an old code

- **WHEN** the warehouse joins last year's sales, keyed by employee code
  21654, to people
- **THEN** they land on the same person as this year's sales under RR-10353

#### Scenario: A code held by two people

- **WHEN** a Team Leader opens their report while their employee code is also
  a current code on another person's record
- **THEN** the report shows them no sections and the problem is recorded for
  an administrator, rather than showing either person's sections
