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

#### Scenario: A workflow action counts as a change

- **WHEN** a rule emails someone whenever a ticket becomes Closed, and the
  user closes a ticket by taking a workflow action
- **THEN** the rule's email goes out

### Requirement: Address an email from the row itself

A rule's recipient, subject and message SHALL be able to include details from
the row, so one rule can email each row's own contact. A rule whose recipient
comes out empty for a row sends nothing for it.

#### Scenario: Email the person who raised the ticket

- **WHEN** a rule emails whoever is named in a ticket's raised-by field and a
  ticket naming a customer's address is saved
- **THEN** that customer's address receives the email

#### Scenario: No address on the row

- **WHEN** the same rule matches a ticket whose raised-by field is empty
- **THEN** no email is sent for that ticket

### Requirement: Email is sent in the background, once each

Email SHALL be queued and delivered in the background, so the action that
caused it doesn't wait, and each message SHALL be delivered exactly once.

#### Scenario: Send a queued email

- **WHEN** an email is queued and the background worker runs, even twice
- **THEN** the recipient receives one copy

### Requirement: Attach a row as a PDF

An email about a row SHALL be able to carry that row as a PDF.

#### Scenario: Email an invoice

- **WHEN** an email about an invoice is sent with the PDF option on
- **THEN** it arrives with a PDF attached whose text shows the invoice's
  details

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

#### Scenario: Only the chosen event

- **WHEN** a webhook is set up for a Table's edit event and a new row is
  created
- **THEN** the webhook's URL is not called

### Requirement: A failed webhook delivery is retried, not lost

If a webhook call fails or the receiving system doesn't confirm it,
Featherbase SHALL try delivering it again automatically, up to a limited
number of attempts.

#### Scenario: Retry after a failure

- **WHEN** a webhook's endpoint is briefly unreachable when it's called
- **THEN** Featherbase tries delivering it again rather than giving up after
  the first failure

### Requirement: Deadlines follow priority

A Table with a service level promise SHALL give each new row a response
deadline and a resolution deadline from the promise for its priority, and
mark it On Track. A priority the promise doesn't cover gets no deadline.

#### Scenario: A high-priority request

- **WHEN** the user creates a High-priority request and the promise is one
  hour to respond and four to resolve
- **THEN** the request is due a response in about an hour and a resolution
  in about four, and is On Track

#### Scenario: A priority with no promise

- **WHEN** the user creates a request whose priority the promise doesn't
  list
- **THEN** it gets no deadlines

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

#### Scenario: A resolved request is left alone

- **WHEN** a request passes its resolution deadline after reaching a state
  the promise counts as fulfilled
- **THEN** it is not marked Overdue and no one is emailed

#### Scenario: No escalation role

- **WHEN** a request passes its deadline and the promise names no escalation
  role
- **THEN** it is marked Overdue and no email is sent

### Requirement: Email reaches people's real inboxes

Once an administrator connects the organisation's mail server, every email
Featherbase sends SHALL go to the recipient's real inbox, over an encrypted
connection. Until then, email stays in a local mailbox for testing.

#### Scenario: A password reset reaches the inbox

- **WHEN** the mail server is connected and the user asks to reset their
  password
- **THEN** the reset link arrives in their own inbox

#### Scenario: A report arrives with its file

- **WHEN** the mail server is connected and an email with a file attached is
  sent
- **THEN** it arrives in the recipient's inbox with the file attached

### Requirement: A failed email is recorded, not lost

When the mail server refuses or cannot be reached, Featherbase SHALL record
the failure for the administrator without the recipient's address or the
message itself. A password reset still answers the same way, so nobody can
use it to find out which accounts exist.

#### Scenario: The mail server is down during a password reset

- **WHEN** the mail server cannot be reached and the user asks to reset their
  password
- **THEN** they see the usual confirmation, and the administrator finds the
  failed send in the server's log

### Requirement: A failed email shows as a failed job

An email that cannot be sent SHALL show as a failed background job, with the
reason, once it will not be tried again. An administrator who retries that
job SHALL get the email sent, once.

#### Scenario: The mail server refuses an email

- **WHEN** the mail server refuses a queued email for good
- **THEN** the administrator's list of background jobs shows its job as
  failed, with the mail server's reason, and it is not tried again on its own

#### Scenario: Retry after fixing the mail server

- **WHEN** the administrator fixes the mail server and retries that failed job
- **THEN** the email is sent, once, and the job shows as done

### Requirement: Nothing sent out carries a sensitive column

A webhook call and a rule's email SHALL leave out every sensitive column,
on the row and in its line items, because whoever receives them is not
known to have the deeper access. A rule may still match on a sensitive
column, or take its recipient's address from one, since neither puts the
value in the email.

#### Scenario: A payslip webhook

- **WHEN** a webhook is set up for payslips and a payslip with a sensitive
  salary is saved
- **THEN** the receiving system gets the payslip without the salary

#### Scenario: A rule email that mentions a sensitive column

- **WHEN** a rule's message includes a payslip's sensitive salary and the
  rule fires
- **THEN** the email goes out with that part left empty
