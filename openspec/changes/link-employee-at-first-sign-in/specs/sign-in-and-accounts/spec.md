## MODIFIED Requirements

### Requirement: Rule for people a method does not know

Each sign-in method SHALL follow the rule an administrator chose for a person
it does not recognise: make an account for them, make one only when the
method vouches for an email address on an allowed domain, make one only when
the person is on the staff roster and the HR system confirms them, or refuse.
A method that cannot vouch for a permanent ID, such as the HR system, can
never make an account for just anyone. A new account starts with no access
beyond what every signed-in person has.

#### Scenario: Google with allowed domains

- **WHEN** Google's rule is to admit only allowed domains and someone unknown
  signs in with a Google account belonging to an allowed company domain
- **THEN** an account is made for them, linked to their Google account, and
  they are signed in

#### Scenario: The HR system cannot make accounts

- **WHEN** an administrator tries to set the HR system's rule to make an
  account for people it does not know
- **THEN** the change is refused, because the HR system cannot vouch for who
  someone is

#### Scenario: Only the HR system can use the staff roster

- **WHEN** an administrator tries to set the staff roster rule on Google or on
  password sign-in, or on the HR system without saying where the roster is
- **THEN** the change is refused

## ADDED Requirements

### Requirement: Staff start using the system at their first HR sign-in

Someone on the staff roster with no account SHALL be able to sign in with their
HR system ID and password. Their first sign-in makes their account, links their
sign-in and marks the roster row as theirs, all together or not at all. Each
later sign-in uses that account.

#### Scenario: A first sign-in

- **WHEN** the HR system's rule is the staff roster, the user's ID is on one
  current roster row that nobody holds, and the HR system confirms the password
  and names that row's record
- **THEN** the user is signed in to a new account with no roles, which is linked
  to the row and holds their employee identifiers, and an administrator can see
  them waiting for access

#### Scenario: A later sign-in

- **WHEN** the user who signed in that way signs in again
- **THEN** they are signed in to the same account and no other account is made

#### Scenario: Two first sign-ins at once

- **WHEN** the same user's first sign-in is sent twice at the same moment
- **THEN** one account is made and both sign-ins land on it

### Requirement: The HR system is asked only about someone on the roster

The HR system SHALL be asked to check a password only for an ID that could
become a sign-in, so the system can't be used to test passwords for other IDs.
Everyone refused sees the same wording as a wrong password.

#### Scenario: An ID that is not on the roster

- **WHEN** someone signs in with an ID on no roster row
- **THEN** they are refused as for a wrong password, and the HR system is not
  asked

#### Scenario: Someone who has left

- **WHEN** someone signs in with an ID whose roster row is not current
- **THEN** they are refused as for a wrong password, and the HR system is not
  asked

### Requirement: Doubtful cases go to an administrator, never a guess

When an ID is on two roster rows, when its row or its values already belong to
someone, or when the HR system confirms a different record than the row's, the
sign-in SHALL be refused as for a wrong password, nothing SHALL change, and the
activity log SHALL tell an administrator which row needs attention, without the
ID, a name or a password.

#### Scenario: Two rows with one ID

- **WHEN** someone signs in with an ID that is on two roster rows
- **THEN** they are refused, the HR system is not asked, and the activity log
  names the row

#### Scenario: The HR system confirms someone else

- **WHEN** the HR system confirms the password but names a different record
  than the roster row's
- **THEN** they are refused, no account is made, and the activity log names the
  row

#### Scenario: Already held

- **WHEN** a person already holds the row's record number or employee code, or
  an ended sign-in carries that record
- **THEN** they are refused, the HR system is not asked, and the activity log
  names the row
