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

#### Scenario: Tickets installed from the command line works at once

- **GIVEN** the server is running and Tickets is not installed
- **WHEN** an administrator runs `featherbase advanced apps install-app tickets`
- **THEN** a requester's next Tickets request succeeds, with no restart

#### Scenario: A changed app under the same version says why

- **GIVEN** Tickets 0.1.0 is installed and the server holds a changed Tickets 0.1.0
- **WHEN** a requester opens Tickets
- **THEN** the refusal says its files (or featherbase.json) changed under the same version, and to re-pin it on a development database or give it a new version
