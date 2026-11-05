## MODIFIED Requirements

### Requirement: See who is waiting for access

A person SHALL wait for an app only after opening it without access: an installed app's pages, Feather Dash or
Featherbase. Opening it SHALL record one request per person and app and say "You don't have access to <App>
yet. An admin has been told." A System Manager SHALL see them as a standard list, newest first, with each
person's full email address and an App column to filter by. A request SHALL leave the list once that person can open
that app; the menu count SHALL count the same rows.

#### Scenario: Opening an app without access

- **WHEN** Priya, who holds only Tasker Member, opens Feather Dash
- **THEN** she sees "You don't have access to Feather Dash yet. An admin has been told."
- **AND** a System Manager sees her on the waiting list with App "Feather Dash" and her email address, and the menu
  count goes up by one

#### Scenario: An app she can open is not a request

- **WHEN** Priya opens Tasker, which she can use
- **THEN** she is not listed as waiting for Tasker

#### Scenario: A new starter shows up

- **WHEN** someone from an allowed company domain signs in with Google for the first time, holding no role
- **THEN** they are not on the waiting list until they open something they have no access to
- **AND** once Featherbase has told them they have no access, a System Manager sees them on the waiting list with
  App "Featherbase"

#### Scenario: Opening it again

- **WHEN** Priya opens Feather Dash again while still waiting
- **THEN** she is listed once for Feather Dash

#### Scenario: Giving a role takes them off the list

- **WHEN** a System Manager gives Priya a role that opens Feather Dash
- **THEN** her Feather Dash request no longer shows, and any request of hers for another app still does

#### Scenario: The waiting list works like any list

- **WHEN** a System Manager filters the waiting list by App "Featherbase" or chooses which columns show
- **THEN** the list narrows and shows those columns the way every other list does, and only waiting requests are
  ever listed

#### Scenario: Only System Managers see the list

- **WHEN** someone who is not a System Manager tries to open the waiting list
- **THEN** they are refused and see no count in their menu

## REMOVED Requirements

### Requirement: Tell System Managers about a new arrival

**Reason**: Signing in no longer makes anyone wait (#955). System Managers are told when a person opens an app
without access, by "Tell System Managers who is asking for access".

**Migration**: None. Alerts already sent stay in the outbox; new ones follow the new requirement.

## ADDED Requirements

### Requirement: Tell System Managers who is asking for access

When a person first asks for an app by opening it without access, every enabled System Manager with an email
address SHALL get one email saying who asked, for which app, and where to give them access. A request still
waiting a day after it was made SHALL be sent again once, in one reminder email to each System Manager listing every
such request. Signing in SHALL NOT send an alert.

#### Normative details for the whole requirement

A failed email SHALL NOT stop the page opening. A day's alerts, counted by the India day, SHALL be capped; the cap
is best-effort, so requests at the same moment can pass it by a few. A request made after the cap is reached SHALL
NOT be emailed about then, but SHALL still show on the waiting list and in the next day's reminder.

#### Scenario: One email per person and app

- **WHEN** Priya opens Feather Dash without access twice, then opens Featherbase without access
- **THEN** each System Manager got exactly two emails about her: one for Feather Dash and one for Featherbase

#### Scenario: A reminder after a day

- **WHEN** Priya's Feather Dash request has waited more than a day and the reminder runs twice
- **THEN** each System Manager got one reminder listing it

#### Scenario: A busy day stops the emails, not the list

- **WHEN** more people ask in one day than the daily cap allows
- **THEN** the later requests are not emailed about that day, and still show on the waiting list

#### Scenario: Mail trouble does not stop the page

- **WHEN** the email cannot be sent as Priya opens Feather Dash
- **THEN** she still sees that an admin has been told, and her request is listed
