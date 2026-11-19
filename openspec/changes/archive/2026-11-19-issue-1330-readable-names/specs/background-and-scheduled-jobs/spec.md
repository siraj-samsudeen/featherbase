## ADDED Requirements

### Requirement: A scheduled job reads by its title

A Scheduled Job SHALL be shown by a readable title, in Title Case, never its
code: on its page, in lists, in links and in Recently Opened. The platform's
own jobs each have one. An app's job takes the title its manifest gives, or
else its name in words. An administrator may change a job's title (#1330).

#### Scenario: A platform job in Recently Opened

- **WHEN** an admin opens the job that escalates SLA breaches
- **THEN** its page and its Recently Opened entry read "Escalate SLA Breaches", not "check_sla"

#### Scenario: An app's job with no title of its own

- **WHEN** an app is installed whose job `escalate_issues` declares no title
- **THEN** the job reads "Escalate Issues"
