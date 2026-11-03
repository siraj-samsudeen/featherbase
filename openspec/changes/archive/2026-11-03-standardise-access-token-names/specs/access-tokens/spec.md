# Access Tokens

## ADDED Requirements

### Requirement: Consistent credential management

The user SHALL manage tokens and, for System Managers, service accounts in separate views using the platform's standard lists, actions, loading, empty and error states. Creation and renaming SHALL use dismissible dialogs with keyboard focus management, pending and error feedback; cancelling SHALL discard unsaved edits.

#### Scenario: Cancel leaves the name alone

```gherkin
Given the service account "warehouse-import-agent" exists
When a System Manager edits its name to "warehouse-reader" but cancels
Then the service account is still named "warehouse-import-agent"
```

### Requirement: Recognisable suggested token names

The user SHALL get an editable suggested token name using the selected owner's display name, a hyphen and one more than the number of that owner's existing tokens, including revoked and expired tokens. Changing owner SHALL update an untouched suggestion but preserve a custom name or deliberate blank; reopening starts a fresh suggestion and a blank cannot be issued.

#### Scenario: Old tokens still count

```gherkin
Given the service account "warehouse-import-agent" owns one revoked token and one expired token
When the user prepares another token for "warehouse-import-agent"
Then its suggested name is "warehouse-import-agent-3"
```

#### Scenario: A deliberate name survives changing owner

```gherkin
Given the user is preparing a token for "warehouse-import-agent"
When the user replaces the suggested name with "nightly export" and changes owner
Then the name remains "nightly export"
```

### Requirement: Rename without replacing credentials

The user SHALL be able to rename their own tokens, and a System Manager SHALL additionally be able to rename any token or service account. Renaming SHALL change only the display name, preserving identity, secrets, ownership, roles, enabled state, expiry, revocation and data access; it never retrieves a secret. Blank or invalid edits SHALL be refused without changing state. Accepted name changes SHALL be recorded with the actor in the activity record.

#### Scenario: A blank token name cannot replace a useful one

```gherkin
Given the service account "warehouse-import-agent" has a working token named "nightly export"
When a System Manager tries to rename the token to a blank name
Then the rename is refused and the token is still named "nightly export"
```

#### Scenario: A renamed automation credential still works

```gherkin
Given the service account "warehouse-import-agent" has a working token named "nightly export"
When a System Manager renames it to "warehouse-reader" and the token to "morning export"
Then the same credential authenticates as the same account named "warehouse-reader"
And the token is listed as "morning export" without its secret
```

#### Scenario: Another person's token cannot be renamed

```gherkin
Given the service account "warehouse-import-agent" has a working token named "nightly export"
When an ordinary user tries to rename that token to "morning export"
Then the rename is refused and the token is still named "nightly export"
```

#### Scenario: A taken service-account name cannot be claimed

```gherkin
Given the service accounts "warehouse-import-agent" and "warehouse-reader" exist
When a System Manager renames "warehouse-import-agent" to "warehouse-reader"
Then the rename is refused and both accounts keep their names
```
