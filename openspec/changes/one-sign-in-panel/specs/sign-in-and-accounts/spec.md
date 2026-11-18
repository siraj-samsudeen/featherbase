## MODIFIED Requirements

### Requirement: Sign in through a connected service

When an administrator has connected an outside sign-in service, such as the
organisation's HR system, the sign-in page SHALL open on that service's form,
because most people who sign in there are store staff who know only their
employee ID.

#### Normative details for the whole requirement

The person types their ID in that service and its password;
Featherbase asks that service to check them and never keeps, logs or shows the
password. The page's other ways in (Google, another connected service, an email
or username and a password) sit under the form, one tap away.

#### Scenario: Sign in with an HR system ID

- **WHEN** the HR system is connected, the user's account is linked to their
  HR system ID, and they sign in with that ID and their HR system password
- **THEN** they are signed in and land where a password sign-in would take
  them

#### Scenario: The service's form comes first

- **WHEN** someone opens the sign-in page while the HR system is connected
- **THEN** the page shows the HR system's ID and password boxes first, and
  offers the other ways in under them, as the one panel of ways in, when those
  ways are on

#### Scenario: Wrong password at the service

- **WHEN** the service says the password is wrong
- **THEN** the user is refused with the same message as a wrong Featherbase
  password, and is not signed in

## ADDED Requirements

### Requirement: One panel of ways in

Wherever a sign-in is offered (the first sign-in page and the "We couldn't sign
you in" card), the ways in SHALL be drawn by one panel: Google, Microsoft, each
connected service, then "Sign in with user name and password", each only when it
is on, in that order and as the same button, none promoted. A page leaves out
only the way in whose form it already shows. The card adds only its heading and
one sentence above the panel.

#### Scenario: The card after a failed Microsoft sign-in

- **WHEN** a Microsoft sign-in comes back refused, because the account is not set
  up or because the attempt took too long or started in another window
- **THEN** the card shows "We couldn't sign you in" and one sentence, then
  "Sign in with Google", "Try another Microsoft account", "Sign in with StyleHR"
  and "Sign in with user name and password", all the same button, and no
  "Other ways to sign in" link

#### Scenario: The first page offers the same ways in

- **WHEN** someone opens the sign-in page while StyleHR is connected
- **THEN** StyleHR's form comes first, and under it the panel offers Google,
  Microsoft and user name and password, in the same order and button as the card
