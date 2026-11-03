# Running an Instance

## ADDED Requirements

### Requirement: Local instances keep separate uploads

Local commands SHALL keep each selected database's uploads separate. Existing shared uploads SHALL remain untouched when isolation is introduced.

#### Scenario: Two local instances have different uploads

```gherkin
Given the user has two disposable local reset instances with different uploads
When the user confirms resetting the first local instance
Then only the first instance's database and isolated uploads are removed
And the other instance and legacy shared uploads remain unchanged
And the user is told to prepare the instance separately
```

### Requirement: Reset requires deliberate local development selection

Reset SHALL require explicit confirmation and a local database recorded as development. It SHALL refuse connected processes or ambiguous upload ownership without killing a process or deleting data. Without confirmation it SHALL describe the selected database, storage location and file count, then fail without changes.

#### Scenario: Preview before confirming

```gherkin
Given the user has two disposable local reset instances with different uploads
When the user previews resetting the first local instance
Then the reset describes the first instance's database and upload count without changing either instance
```

#### Scenario: Unsafe targets remain untouched

```gherkin
Given the user has two disposable local reset instances with different uploads
When the user attempts reset with unsafe target selections
Then every unsafe reset is refused without changing either instance
```
