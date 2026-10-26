## MODIFIED Requirements

### Requirement: Return to where they were headed

Signing in from a link to a specific page SHALL land the user back on that
exact page, not just the general landing page, whichever way they sign in.
Only a page of this site is ever returned to.

#### Scenario: Sign in from a deep link

- **WHEN** a signed-out user follows a link to a specific record and then
  signs in
- **THEN** they land on that record, not on the general landing page

#### Scenario: Sign in with Google from a deep link

- **WHEN** a signed-out user follows a link to a specific settings page and
  signs in with Google
- **THEN** they land on that settings page after Google sends them back
