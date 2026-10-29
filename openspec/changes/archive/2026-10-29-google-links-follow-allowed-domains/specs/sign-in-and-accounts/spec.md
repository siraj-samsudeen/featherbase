## MODIFIED Requirements

### Requirement: Sign in with Google

Featherbase SHALL let a user sign in with their Google account. A Google
account that is linked to a person opens that person's account; any other
Google account is handled by the rule an administrator chose for people
Google does not recognise. While Google sign-in lists allowed domains, a
link that person made themselves, or that the domain rule made, SHALL open
the account only while that rule still admits the account; a link an
administrator made, or an invite the person claimed, SHALL keep opening it.

#### Scenario: First-time sign-in from an allowed domain

- **WHEN** someone with no Featherbase account signs in with a Google account
  belonging to an allowed company domain
- **THEN** an account is created for them and they are signed in

#### Scenario: Domain not allowed

- **WHEN** someone with no Featherbase account signs in with Google using an
  address from a domain that isn't allowed
- **THEN** they are refused and told to contact IT

#### Scenario: A domain is removed from the list

- **WHEN** a person who linked a Google account on a domain signs in with it
  after an administrator removed that domain from the allowed list
- **THEN** they are refused and told to contact IT, and the link is kept, so
  adding the domain back lets them in again

#### Scenario: An administrator's link outside the list

- **WHEN** an administrator linked a person's personal Google account and
  that person signs in with it while only a company domain is allowed
- **THEN** they are signed in

#### Scenario: Narrowing the list would lock out a System Manager

- **WHEN** an administrator removes the only domain through which a System
  Manager can still sign in
- **THEN** the change is refused and names the System Manager

### Requirement: A person links another method themselves

A signed-in person SHALL be able to link another sign-in method to their own
account by proving it, for example by completing a Google sign-in, where an
administrator allows it for that method. They must have signed in within the
last few minutes, and a method already linked to someone else is refused.
Where the method lists allowed domains, the account SHALL pass the same
domain rule as a first sign-in, or the link is refused and nothing changes.

#### Scenario: Add Google to an HR system account

- **WHEN** a Team Leader who just signed in with their HR system ID chooses to
  link a Google account and completes Google's sign-in
- **THEN** that Google account is linked and later opens the same account

#### Scenario: Already someone else's

- **WHEN** a person tries to link a Google account that is already linked to a
  different account
- **THEN** the link is refused and neither account changes

#### Scenario: A personal account where only the company domain is allowed

- **WHEN** a person tries to link a personal Gmail account while Google
  sign-in allows only the company domain
- **THEN** the link is refused, nothing is linked, and the sign-in methods
  page says the account is not on a domain the site allows
