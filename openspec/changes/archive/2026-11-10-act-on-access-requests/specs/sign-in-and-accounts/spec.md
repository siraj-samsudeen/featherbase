## ADDED Requirements

### Requirement: Act on a request for access

A System Manager SHALL be able to open a waiting request beside the waiting list and see who the person is,
how they sign in, their job as installed apps describe it, and what they asked for. From there they SHALL
approve it with roles and the access apps give, decline it with a reason, or dismiss it. Each decision SHALL
be recorded in the activity log with who made it, the person, the app, and what was given or why it was
declined. No email SHALL be sent for any of them.

#### Scenario: Approving with a role and a report

- **WHEN** a System Manager approves Priya's request for Dash with the role Master Data Editor and the report
  Company notices
- **THEN** Priya holds the role and the report, the activity log names both, and once she can open Dash her
  request leaves the list

#### Scenario: Given, but it does not open the app

- **WHEN** what was given does not let Priya open the app she asked for
- **THEN** the System Manager is told so, and her request stays on the list

#### Scenario: Declining a request

- **WHEN** a System Manager declines Priya's request for Featherbase with the reason "Not in head office"
- **THEN** the request leaves the waiting list and the menu count, and shows in the Declined view with the
  reason, who declined it and when
- **AND** when Priya opens Featherbase again she is told "An admin declined your request. Ask your manager if
  you need it.", without the reason, and nobody is emailed

#### Scenario: A declined person gets access another way

- **WHEN** Priya, declined for Featherbase, is later given a role that opens it
- **THEN** her declined request goes

#### Scenario: Dismissing a false alarm

- **WHEN** a System Manager dismisses Priya's request
- **THEN** it is gone, and opening the app again makes a fresh request

### Requirement: A grant from a request gives no more than the admin could

Only a System Manager SHALL see or decide a request this way. Roles SHALL be given through the same rule as
editing a person's roles. An app's access SHALL be given through the app's own declared action, under its own
rules, and only for what that app offers the person. Giving System Manager SHALL need a confirmation.

#### Scenario: System Manager is confirmed

- **WHEN** a System Manager ticks System Manager for Priya and approves
- **THEN** they are warned that it gives full admin access, and nothing is given until they confirm

#### Scenario: Only a System Manager decides

- **WHEN** someone who is not a System Manager, a Report Access Manager included, tries to see or decide a
  request this way
- **THEN** they are refused and nothing changes
