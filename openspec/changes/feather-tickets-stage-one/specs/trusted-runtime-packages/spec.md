# Trusted runtime packages

## ADDED Requirements

### Requirement: Packages can protect stable identities and retained records
An **App** SHALL be able to refuse generic renaming and deletion of its owned **Tables**' records through an optional destructive-operation guard. The guard SHALL run inside the host transaction before the destructive change, including for Administrator, without changing existing packages' save validators or granting additional permissions.

#### Scenario: Shared ticket visibility cannot rename a stable reference

```gherkin
Given Anjali has an access ticket visible in the shared queue
And the user is another requester without support permissions
When the user attempts to rename Anjali's ticket
Then the rename is refused and the original reference still opens its private request for Anjali
```

#### Scenario: Administrator cannot erase protected evidence

```gherkin
Given Anjali's missing-invoice ticket has a recorded mismatch
When Administrator attempts to delete its evidence using the current revision
Then deletion is refused and the evidence remains attributed in support history
```

### Requirement: An app's actions and reads know their caller's own name
An **App**'s action and read context SHALL carry the caller's own display name (full name, else `@username`), the name the caller's session already shows them. It SHALL never carry another person's name or contact data, and SHALL need no Person read permission.

#### Scenario: Tickets records the name of the person acting

```gherkin
Given the user is signed in as Anjali
When the user submits "Please check the Palakkad totals" as a free-text request
Then support sees the requester by the name Anjali's own session shows, not by her person id
```

### Requirement: An install or enable takes effect without a restart
An **App** installed or enabled by another process while the server runs SHALL start serving on its next request when this server holds its exact package, with no restart. When it cannot run here, its refusals and the Apps screen SHALL state the plain reason and what to do, and SHALL still be audited and fail closed.

#### Scenario: Tickets turned on by another process works at once

```gherkin
Given Tickets was turned off and then turned on again by another process while the server ran
When Anjali opens Tickets
Then Tickets answers without a restart
```

#### Scenario: A changed app under the same version says why

```gherkin
Given the installed Tickets 0.1.0 records a different build than the one this server holds
When Anjali opens Tickets
Then the refusal says its files changed under the same version and how to fix it
```

### Requirement: An administrator may let an app read named instance Tables
An administrator SHALL be able to list instance Tables in an app's declared `linked_tables` setting. That app's actions and reads SHALL then read those Tables, and never write them, as the caller with the caller's own permissions. Tables owned by another app, system Tables and data sources SHALL stay refused.

#### Scenario: Tickets reads a linked instance Table as the requester

```gherkin
Given an administrator lists a Source System Table that only Pat may read in Tickets' linked_tables setting
When Pat and Anjali open the Data Quality Issue form
Then Pat's Source system field offers its rows and Anjali's offers none
```
