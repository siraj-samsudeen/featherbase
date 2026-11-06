# Tickets investigation and resolution

## ADDED Requirements

### Requirement: Separate a reported problem from a supported finding
Support staff SHALL be able to record expected and observed outcomes, investigation evidence and a finding without treating the original complaint as proof of a defect.

#### Scenario: A stale-data report starts unconfirmed

```gherkin
Given Anjali reports "Invoices cleared two days ago are missing from the report"
And the user is authorized to investigate the ticket
When the user begins investigation without source or report evidence
Then the complaint remains unconfirmed
And no automated diagnosis or warehouse query is claimed
```

#### Scenario: Evidence supports a finding without inventing its cause

```gherkin
Given Anjali reports "Invoices cleared two days ago are missing from the report"
And the user is authorized to investigate the ticket
When the user records a confirmed mismatch with expected 2 invoices from "source-check-1" and observed 0 from "report-check-1" for 2026-11-01, observed at 2026-11-03T09:00:00Z
Then reopening the ticket shows that finding, both evidence references, observation time and author
And the finding's root cause remains unknown
```

### Requirement: Link investigation to related work
Support staff SHALL be able to attach related issue or pull-request references without claiming that Tickets created or executed that work.

#### Scenario: Related work is a reference rather than an agent action

```gherkin
Given Anjali's missing-invoice ticket is being investigated
And the user is authorized to investigate the ticket
When the user adds an existing GitHub issue reference
Then the reference is available in the ticket's support history
And the ticket does not claim that an agent created an issue or pull request
```

### Requirement: Preserve an accountable path to resolution
Support staff SHALL be able to resolve a non-access ticket with a reason and evidence, or reopen it with a reason. Tickets SHALL retain classification, assignment, verification, scope changes, access decisions, findings and resolution as domain history using the platform's existing attribution and history protection.

#### Scenario: A supported resolution remains available

```gherkin
Given Anjali's missing-invoice ticket has a recorded mismatch
And the user is authorized to investigate the ticket
When the user resolves it with reason "Report refreshed and both invoices present" and evidence "report-check-2"
Then reopening the ticket shows the resolution, reason, evidence and responsible user
```

#### Scenario: A resolved investigation can be reopened without losing its finding

```gherkin
Given Anjali's missing-invoice ticket was resolved with a recorded finding and evidence
And the user is authorized to investigate the ticket
When the user reopens it because "The next day's report is still missing invoices"
Then the ticket returns to active work
And its earlier resolution, evidence and reopening reason remain attributed in history
```

#### Scenario: Resolution cannot bypass access fulfillment

```gherkin
Given Anjali has an unapproved access request
And the user is authorized to investigate tickets but not fulfill access
When the user attempts to resolve it as an ordinary investigation
Then resolution is refused and the request remains unfulfilled
```

### Requirement: Distinguish unconfigured connections from live results
The user SHALL be told when employee lookup, inbound email or automated investigation is unconfigured, without simulated results being presented as live activity.

#### Scenario: Unconfigured connections do not claim activity

```gherkin
Given Tickets has no live integration configuration
And the user is authorized to manage support
When the user inspects connection status
Then employee lookup, inbound email and automated investigation are shown as unconfigured
And no received email, employee match or agent execution is claimed
```

### Requirement: Keep development samples opt-in and fictional
An ordinary Tickets installation SHALL contain no sample business requests; development users SHALL be able to opt into clearly fictional sample tickets and evidence.

#### Scenario: An ordinary installation has no sample requests

```gherkin
Given Tickets was installed without requesting development samples
When the user inspects the support queue
Then no sample tickets or fictional investigation findings are present
```

#### Scenario: Explicit development samples are identified as fictional

```gherkin
Given Tickets is running in a development instance without real business requests
When the user explicitly loads the development samples
Then fictional tickets are available for the walkthrough
And their employee and investigation evidence is identified as fictional rather than production findings
```
