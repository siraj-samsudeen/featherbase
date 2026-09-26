# Notifications, Email and Webhooks

## Purpose

Featherbase can tell people and other systems when something happens to a
row — by email, by an in-app notification, or by calling another system's own
URL — and can escalate when a deadline passes with nothing done.

## Requirements

### Requirement: Email people when a row matches a rule

An email rule SHALL email its recipient whenever its chosen event happens to
a row and, if the rule names a condition, only when the row currently matches
it — not on every later save while it keeps matching.

#### Scenario: Notify on a matching submit

- **WHEN** a rule emails a manager whenever a High-priority request is
  submitted, and a High-priority request is submitted
- **THEN** the manager gets an email about it

#### Scenario: A rule doesn't re-fire while the row keeps matching

- **WHEN** a row already matches a rule's condition and is saved again
  without leaving that condition
- **THEN** no further email goes out for that rule; it only fires again the
  next time the row moves into the matching value

### Requirement: Get notified when a row is assigned to you

Assigning a row to someone SHALL leave them an in-app notification linking
back to the row, and their unread count updates without reloading the page.

#### Scenario: Assign a row

- **WHEN** a user assigns a task row to a teammate
- **THEN** the teammate gets a notification linking to that row and their
  unread count goes up

### Requirement: Get notified when you're mentioned in a comment

Mentioning someone by name in a comment SHALL leave them an in-app
notification linking back to the row, and their unread count updates without
reloading the page.

#### Scenario: Mention someone in a comment

- **WHEN** a user mentions a teammate by name in a comment on a row
- **THEN** that teammate gets a notification about the mention

### Requirement: Call another system when something happens

A webhook SHALL call its configured URL with the row's current data whenever
its chosen event happens, signed so the receiving system can verify the call
came from Featherbase.

#### Scenario: Notify another system on submit

- **WHEN** a webhook is set up for a Table's submit event and a row is
  submitted
- **THEN** the webhook's URL receives the row's data along with a signature
  proving it came from Featherbase

### Requirement: A failed webhook delivery is retried, not lost

If a webhook call fails or the receiving system doesn't confirm it,
Featherbase SHALL try delivering it again automatically, up to a limited
number of attempts.

#### Scenario: Retry after a failure

- **WHEN** a webhook's endpoint is briefly unreachable when it's called
- **THEN** Featherbase tries delivering it again rather than giving up after
  the first failure

### Requirement: Escalate a deadline nobody met

A Table's rows can carry a response and resolution deadline set from their
priority. A row still open past its resolution deadline SHALL be marked
overdue and emailed to whoever holds the escalation role, once per breach.

#### Scenario: A missed deadline is escalated

- **WHEN** a High-priority request passes its resolution deadline while still
  open
- **THEN** it is marked Overdue and the holders of the escalation role are
  emailed about it
- **AND** it is not escalated again for the same breach
