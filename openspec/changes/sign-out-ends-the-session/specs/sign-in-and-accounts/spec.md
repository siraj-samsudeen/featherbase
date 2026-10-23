# Sign In and Accounts Delta

## MODIFIED Requirements

### Requirement: Sign out

Signing out SHALL end that session immediately, everywhere it is used, even if the session was already invalid or expired. The same person's sessions on other devices SHALL stay signed in.

#### Scenario: Sign out ends access

- **WHEN** a signed-in user signs out and then tries to go back
- **THEN** they are asked to sign in again

#### Scenario: A copy of the signed-out session stops working

- **WHEN** someone kept a copy of a user's session and the user signs out
- **THEN** the copy is refused from then on, and its live updates stop

#### Scenario: Other devices stay signed in

- **WHEN** a user signed in on two phones signs out on one of them
- **THEN** the other phone stays signed in
