# Sign In and Accounts Delta

## ADDED Requirements

### Requirement: Test mode for sign-in through a connected service

A deployment MAY switch on test mode for sign-in through a connected service,
only through its server environment and only with an exact switch value. While
it is on, the service SHALL NOT be asked: a tester signs in as a person by
typing that person's employee code (their account's ID) and no password — not
the person's login name at the service, which a tester does not know. Who may
sign in is otherwise unchanged — one account that is linked to the service,
enabled, and not the Administrator or a System Manager. The sign-in page SHALL
say that test mode is on and ask for an employee code.

Because the service is not asked, it cannot report that someone has left.
While test mode is on, a person who has left is refused only when their
account is disabled; the instance that runs test mode SHALL keep leavers'
accounts disabled (the roster sync's leaver option). Test mode is for a trial
instance and SHALL NOT be switched on where real users sign in.

#### Scenario: Open the report as a Team Leader during a trial

- **WHEN** test mode is on and the tester types a Team Leader's employee code with no password
- **THEN** they are signed in as that Team Leader and the service is not contacted

#### Scenario: Test mode does not widen who can sign in

- **WHEN** test mode is on and the employee code belongs to no account, to an account not linked to the service, to a disabled account or to a System Manager
- **THEN** sign-in is refused exactly as it would be with the service asked

#### Scenario: The service login name is not the test-mode ID

- **WHEN** test mode is on and the tester types the person's login name at the service
- **THEN** sign-in is refused; test mode looks people up by employee code only

#### Scenario: Anything but the exact switch value leaves it off

- **WHEN** the switch holds a value such as "1" or "true"
- **THEN** the service is asked and a password is required, as without test mode

#### Scenario: The page says so

- **WHEN** test mode is on and a service is connected
- **THEN** the sign-in form shows a test-mode notice, asks for an employee code, and has no password field
