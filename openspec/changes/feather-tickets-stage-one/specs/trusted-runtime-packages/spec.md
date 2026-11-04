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
