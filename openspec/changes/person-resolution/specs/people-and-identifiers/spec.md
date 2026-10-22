# People and Identifiers

## Purpose

One real person is known by many names: an employee code from each spell of
employment, a national ID, a phone number, several email addresses, a record
number in another system. Featherbase keeps one record for the person, attaches
every identifier they have ever had to it, suggests when two records look like
one person, lets a reviewer confirm or refuse, and can undo a merge. Reports
and other systems see one stable person.

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

### Requirement: Identifier systems are set up once, with sensible defaults

An administrator SHALL be able to define each kind of identifier Featherbase
knows — what it identifies, how a value is tidied before use, whether one
value may belong to only one person at a time, whether a person may hold only
one current value, how much of it is shown, who may see and edit it, and
whether a match on it may suggest or decide that two records are one person.
A ready-made set ships for the organisation's own systems, so the usual case
needs no set-up, and every setting can be changed later.

#### Scenario: The shipped set covers a new instance

- **WHEN** an administrator opens a fresh instance
- **THEN** the HR employee code, the HR record number, Aadhaar, mobile phone
  and email address are already defined, with Aadhaar set to be fingerprinted
  and shown by its last four digits only

#### Scenario: A rule that would be unsafe is refused

- **WHEN** an administrator tries to let a phone number decide on its own
  that two records are one person
- **THEN** the change is refused and the reason explains that only a strong,
  one-per-person identifier may decide, and never one that signs people in

### Requirement: Every identifier a person has had is kept and searchable

A person's identifiers SHALL be kept with the period each was valid, where it
came from and whether it is current or old. An old identifier still finds the
person, and still applies to the time it was valid.

#### Scenario: An agency code that became a company code

- **WHEN** a sales assistant who started through an agency as 21654 is later
  hired directly as RR-10353 and the two records are confirmed as one person
- **THEN** searching 21654 finds them, their record shows 21654 as an old code
  valid until the conversion date and RR-10353 as the current one, and a
  report for a month before the conversion still counts 21654's sales as
  theirs

#### Scenario: A rehire

- **WHEN** someone who left returns and the HR system reactivates their old
  code
- **THEN** their record shows the code as current again with a new start
  date, and the earlier spell is kept as history

### Requirement: Sensitive identifiers are never shown in full

A national ID such as Aadhaar SHALL never be stored or shown in full.
Featherbase keeps only a keyed fingerprint, used to detect that two records
carry the same number, and the last four digits, which is all anyone sees.
Identifiers marked restricted are visible only to people allowed to see
restricted data.

#### Scenario: Aadhaar on a person's record

- **WHEN** an administrator opens a store assistant's record
- **THEN** the Aadhaar line shows only its last four digits, and the full
  number cannot be retrieved from Featherbase by anyone

#### Scenario: A phone number for someone without restricted access

- **WHEN** a person who may not see restricted data opens the same record
- **THEN** the phone number and the Aadhaar line are not shown at all

### Requirement: Possible duplicates are suggested, a reviewer decides

When two records share an identifier that counts as a clue — the same
fingerprinted national ID, the same phone, the same email — Featherbase SHALL
raise a suggestion in a review list rather than merge them. A reviewer sees
both records side by side with the reasons, then confirms they are one
person or marks them as different people. "Different people" sticks, so the
pair is not raised again.

#### Scenario: Same Aadhaar on two employee records

- **WHEN** the roster brings in RR-10353 whose Aadhaar fingerprint equals the
  one already on 21654's record
- **THEN** a strong suggestion appears in the review list showing both
  records, their worker types and dates, and the matching last four digits

#### Scenario: Same phone, different people

- **WHEN** two records share a phone number but carry different Aadhaar
  fingerprints, and the reviewer marks them as different people
- **THEN** both records stay as they are and the pair does not come back,
  even when the roster brings the same phone again

### Requirement: Merging two records keeps everything and can be undone

Confirming that two records are one person SHALL merge them into one
surviving record: roles, data access, sign-in methods, identifiers and every
place the other record was referred to move to the survivor. The merged-away
record is kept, inactive, pointing at the survivor; nothing is deleted. One
action undoes the merge, putting back what was moved; anything added since the
merge is listed for the reviewer to decide.

#### Scenario: Conversion confirmed

- **WHEN** a reviewer confirms that 21654 and RR-10353 are one person
- **THEN** RR-10353's record survives with both codes, both sign-in methods
  and the union of their access; 21654's record stays, inactive, and opening
  it leads to the survivor

#### Scenario: A wrong merge undone

- **WHEN** a reviewer merged two namesakes a week ago and now undoes it
- **THEN** each record gets back its own roles, access, sign-in methods and
  codes; the merged-away record is active again; and the two rows added to
  the survivor since the merge are shown for a hand decision

### Requirement: A merge never quietly widens access

Before a merge is confirmed, Featherbase SHALL show the reviewer every role,
data access and sign-in method the surviving person would gain, and require
them to acknowledge it. A merge cannot give someone Administrator or System
Manager unless an Administrator performs it.

#### Scenario: A reviewer sees what the survivor gains

- **WHEN** a Data Quality Manager merges a Team Leader's old record into their
  current one, and the old record still carries access to another store
- **THEN** the preview lists that store as access the person would gain, and
  the merge waits until the reviewer acknowledges it

#### Scenario: Privileged access cannot arrive by merge

- **WHEN** a Data Quality Manager tries to merge a record that holds System
  Manager into one that does not
- **THEN** the merge is refused and names the role that only an Administrator
  may carry across

### Requirement: Automatic linking is an opt-in that never touches a way in

By default no identifier SHALL decide a merge on its own. An administrator MAY
turn automatic linking on for one identifier system at a time, and only for a
strong identifier that a person holds once, such as Aadhaar. Even then,
Featherbase SHALL merge automatically only when neither record holds
privileged access or data access, and never for an identifier that signs
people in; otherwise it raises a suggestion instead. Every automatic merge is recorded
and can be undone like any other.

#### Scenario: Automatic linking on, a plain conversion

- **WHEN** automatic linking is on for Aadhaar and the roster brings a new
  code whose fingerprint matches one other record, neither record having any
  data access or privileged role
- **THEN** the records are merged without a reviewer, the merge is recorded
  as automatic, and the person signs in to the one record the next day

#### Scenario: Automatic linking on, a store manager

- **WHEN** the same happens but one of the records is a Store Manager with
  access to their store
- **THEN** no merge happens; a suggestion appears in the review list saying
  why it was not automatic

### Requirement: Who may change an identifier

Each identifier system SHALL say who may add, end or correct its values: the
system that feeds it (then people can only read it), System Managers, named
reviewer roles, or the person themselves for their own contact details. A
value fed by another system is corrected there, not in Featherbase. Every
change records who made it and when.

#### Scenario: A code from the HR system

- **WHEN** a System Manager tries to edit an employee code that the HR roster
  feeds
- **THEN** they are told the code comes from the HR system and is corrected
  there

#### Scenario: A person updates their own phone

- **WHEN** a Team Leader adds a new mobile number to their own record
- **THEN** the number is saved with today as its start date and the earlier
  number is kept as history

### Requirement: Reports see one stable person

Every record SHALL carry a permanent person identity that never changes
through merges, code changes or new employments, and the warehouse receives it
together with every code that has ever mapped to it and when. A merged-away
record keeps pointing at its survivor so an old reference still resolves.

#### Scenario: Last year's sales under an old code

- **WHEN** the warehouse joins last year's sales, keyed by employee code
  21654, to people
- **THEN** they land on the same person as this year's sales under RR-10353
