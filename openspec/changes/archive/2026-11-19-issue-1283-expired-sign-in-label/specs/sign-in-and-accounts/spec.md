## MODIFIED Requirements

### Requirement: One panel of ways in

Wherever a sign-in is offered, the page SHALL be drawn one way: its open form,
"or", then one panel of the other ways in (Google, Microsoft, each connected
service, then "Sign in with user name and password"), each only when it is on,
in that order and as the same button. The "We couldn't sign you in" card is that
same page with only its heading and one sentence above it. Only an account the
service refused is offered as "Try another … account".

#### Scenario: The card after a failed Microsoft sign-in

- **WHEN** a Microsoft sign-in comes back refused because the account is not set up
- **THEN** the card shows "We couldn't sign you in" and one sentence, then the
  first page exactly: StyleHR's form, "or", "Sign in with Google", "Try another
  Microsoft account" and "Sign in with user name and password", all the same
  button, and no "Other ways to sign in" link

#### Scenario: The card after a sign-in that took too long

- **WHEN** a Microsoft sign-in comes back because the attempt took too long or
  started in another window
- **THEN** the card shows "We couldn't sign you in" and one sentence, then the
  first page exactly as it is, with "Sign in with Microsoft"

#### Scenario: The first page offers the same ways in

- **WHEN** someone opens the sign-in page while StyleHR is connected
- **THEN** StyleHR's form comes first, and under it the panel offers Google,
  Microsoft and user name and password, exactly as the card shows them
