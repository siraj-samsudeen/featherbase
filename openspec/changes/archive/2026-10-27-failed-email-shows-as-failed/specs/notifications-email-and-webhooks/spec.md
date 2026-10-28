## ADDED Requirements

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
