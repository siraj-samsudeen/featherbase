# Sign In and Accounts Delta

## MODIFIED Requirements

### Requirement: Sign in through a connected service

When an administrator has connected an outside sign-in service, such as the
organisation's HR system, the sign-in page SHALL open on that service's form,
because most people who sign in there are store staff who know only their
employee ID. The person types their ID in that service and its password;
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
  offers "Sign in with Google" and "Use email and password instead" under them,
  when those ways are on

#### Scenario: Wrong password at the service

- **WHEN** the service says the password is wrong
- **THEN** the user is refused with the same message as a wrong Featherbase
  password, and is not signed in

## ADDED Requirements

### Requirement: The sign-in page carries the instance's own name and logo

The sign-in page SHALL show the instance's name and, when an administrator has
set one in System Settings, the instance's own logo; without one it shows the
Featherbase mark. The logo is shown before sign-in only when it is an image this
instance serves publicly, and a settings file never manages it, because the file
lives in one instance's own storage.

#### Scenario: A store's own logo

- **WHEN** an administrator uploads the business's logo to System Settings and
  someone opens the sign-in page
- **THEN** the page shows that logo above the instance's name

#### Scenario: No logo set

- **WHEN** no logo is set
- **THEN** the sign-in page shows the Featherbase mark above the instance's name
