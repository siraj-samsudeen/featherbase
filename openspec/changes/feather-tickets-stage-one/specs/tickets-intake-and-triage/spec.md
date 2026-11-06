# Tickets intake and triage

## ADDED Requirements

### Requirement: Capture a request without choosing a category
The user SHALL be able to submit a free-text request and return to its saved ticket, a tracked support request with a stable reference.

#### Scenario: A hurried request remains available

```gherkin
Given the user is signed in as Anjali
When the user submits "Please give me MotherDuck access" as a free-text request
Then the user receives a ticket reference
And the request remains available after signing out and back in
```

### Requirement: Capture the details appropriate to the request
The user SHALL be able to supply structured details appropriate to access, stale or missing data, incorrect data or reconciliation, reports or exports, new sources, new columns or models, pipeline failures and backfills without inventing missing information.

#### Scenario: An access request identifies its intended recipient and scope

```gherkin
Given the user is signed in as Anjali
When the user requests MotherDuck access for "anjali@example.com" to "Gold sales, read only"
Then the ticket retains that recipient and requested scope
And employment remains unverified
```

#### Scenario: A report request records its delivery needs

```gherkin
Given the user is signed in as Anjali
When the user requests an Excel sales report for Palakkad from 2026-10-01 through 2026-10-31
Then the ticket retains the location, period and requested format
```

#### Scenario: A stale-data request records what should have arrived

```gherkin
Given the user is signed in as Anjali
When the user reports missing cleared Zakya invoices for 2026-11-01 in the daily sales report
Then the ticket retains the source, affected report, date and expected invoices
And it does not invent a confirmed root cause
```

#### Scenario: A new-source request records its ingestion needs

```gherkin
Given the user is signed in as Anjali
When the user requests a new vendor API source for daily stock movements with an hourly refresh
Then the ticket retains the source, requested data and refresh need
```

### Requirement: Classify without rewriting the original
Support staff SHALL be able to classify a ticket and complete its structured details while the original submitted message remains unchanged. Only an explicit correction by the requester or support SHALL change its wording (#918), and the earlier wording SHALL be kept with who replaced it and when, for whoever reads the request.

#### Scenario: A free-text request becomes an access request

```gherkin
Given Anjali submitted "Please give me MotherDuck access" as a free-text request
And the user is authorized to triage the ticket
When the user classifies it as access and records "Gold sales, read only" as the requested scope
Then the ticket is an access request with that scope
And its original message is still "Please give me MotherDuck access"
```

### Requirement: Find the next request to work
Support staff SHALL be able to find tickets by reference or words and narrow work by category, status and responsible person.

#### Scenario: A copied reference finds the ticket

```gherkin
Given Anjali has a ticket with reference "FT-1042"
And the user is authorized to triage the ticket
When the user searches for "FT-1042"
Then the matching ticket is available
```

#### Scenario: Assigned work excludes unrelated tickets

```gherkin
Given Anjali has an open access ticket assigned to the user
And another open report ticket is assigned to a colleague
When the user requests their open access work
Then Anjali's ticket is included and the colleague's report ticket is excluded
```

### Requirement: Keep requester visibility separate from support work
Signed-in requesters SHALL share ticket summaries and public progress across the instance, while original request details remain available only to their submitter and authorized support. Employee-verification details, diagnostic evidence and internal notes SHALL remain restricted to authorized support staff.

#### Scenario: Internal investigation is not disclosed to the requester

```gherkin
Given Anjali has an access ticket with public progress and a support-only note
And the user is signed in as Anjali
When the user reads their ticket
Then the public progress is available and the support-only note is not disclosed
```

#### Scenario: A colleague can follow public progress

```gherkin
Given Anjali has an access ticket with public progress and private employee-verification evidence
And the user is another requester without support permissions
When the user finds Anjali's ticket in the shared queue
Then its summary and public progress are available
And the original request details and employee-verification evidence are not disclosed
```

### Requirement: Shared visibility does not grant control
Seeing another person's ticket in the shared queue SHALL not grant permission to edit that request or make support decisions.

#### Scenario: A colleague cannot change the request

```gherkin
Given Anjali has an access ticket visible in the shared queue
And the user is another requester without support permissions
When the user attempts to change Anjali's requested scope
Then the edit is refused and the requested scope is unchanged
```
