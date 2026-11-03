# Spreadsheet Import

## ADDED Requirements

### Requirement: Re-import previews distinguish value changes

The immediate preview and the user's explicit check SHALL split matched rows into changed and unchanged, with the number of mapped values that will change, alongside added, skipped and refused rows. The explanation SHALL agree with the chosen matching mode; classification changes presentation and confirmation, not import automation, source observations, provenance, undo or historical processed-count meaning.

#### Scenario: An identical file changes no values

```gherkin
Given the user has imported 61 zones with their populations
When the user chooses zone codes to match the identical zones file before requesting a check
Then the preview reports 0 changed rows, 61 unchanged rows and 0 added rows
And the preview reports 0 changed values and explains matching rather than appending
```

#### Scenario: One changed population does not count the whole file

```gherkin
Given the user has imported 61 zones with their populations
When the user checks the zones file with one changed population matched on its zone codes
Then the preview reports 1 changed row, 60 unchanged rows and 0 added rows
And the preview reports 1 changed value
```

#### Scenario: An unchanged re-import is still recorded

```gherkin
Given the user has imported 61 zones with their populations
When the user imports the identical zones file matched on its zone codes
Then import history records 61 processed matches rather than 61 value changes
And undoing that import reports that the 61 matched rows had no values changed
```

### Requirement: A fully overlapping append is deliberate

When the user chooses no matching column and every incoming row has a distinct nonblank value matching exactly one readable existing row in an eligible mapped column whose values the user may read, the import SHALL warn that appending adds another set and require explicit acknowledgement before proceeding. The user SHALL be able to choose a matching column instead; deliberate append remains available, and an inability to check overlap SHALL NOT be treated as proof that no rows overlap.

#### Scenario: Appending the identical file waits for acknowledgement

```gherkin
Given the user has imported 61 zones with their populations
When the user imports the identical zones file without choosing a matching column
Then the import waits for acknowledgement that 61 more rows will be added
And the user can choose the suggested zone codes instead
```

#### Scenario: The acknowledged append adds the second set

```gherkin
Given the user has imported 61 zones with their populations
And the user has been warned that appending the identical zones file adds 61 more rows
When the user explicitly acknowledges the append
Then the zones contain 122 rows
```

## MODIFIED Requirements

### Requirement: The matching column is remembered

Re-importing into a table that was matched with a column before SHALL offer that column when still mapped, permitted and usable, named for explicit acceptance or replacement, never applied silently. Other eligible mapped columns whose distinct nonblank incoming values match every incoming row one-to-one with readable existing rows SHALL also be offered using the existing matching rules, without guessing which column identifies the rows or disclosing unreadable values.

#### Scenario: The same matching column is suggested next time

```gherkin
Given the user has imported 61 zones matched on their zone codes
When the user prepares the zones file for another import
Then zone codes are offered as the remembered matching column
And no matching column is active until the user accepts or chooses one
```

#### Scenario: A matching column is offered without a previous keyed import

```gherkin
Given the user has imported 61 zones without choosing a matching column
When the user prepares the identical zones file for another import
Then zone codes are offered because each incoming code matches exactly one readable zone
And no matching column is active until the user accepts or chooses one
```

#### Scenario: Ambiguous values are not offered as a safe match

```gherkin
Given the user has imported zones with repeated zone codes
When the user prepares the zones file for another import
Then the repeated zone codes are not offered as a one-to-one matching column
```

#### Scenario: An unreadable matching column is not offered

```gherkin
Given the user can read the zones but cannot read their zone codes
When the user prepares the identical zones file for another import
Then zone codes are not offered as a matching column or used to disclose overlap
```

#### Scenario: An unmapped remembered column is not offered

```gherkin
Given the user has imported 61 zones matched on their zone codes
When the user prepares another zones file without mapping its zone codes
Then zone codes are not offered as a remembered matching column
```

### Requirement: A large update is confirmed before it runs

At import time, a fresh changed-row count across the selected unfinished targets and all their parts SHALL determine whether more than 20 existing rows would change mapped values and require that exact count to be typed. Unchanged matches and retained corrections alone SHALL NOT increase that count; missing or wrong confirmation leaves the import blocked, and changed import choices invalidate confirmation.

#### Scenario: An identical large file needs no change confirmation

```gherkin
Given the user has imported 61 zones with their populations
When the user imports the identical zones file matched on its zone codes
Then the import proceeds without a typed change count
```

#### Scenario: Twenty changed rows need no typed count

```gherkin
Given the user has imported 61 zones with their populations
When the user imports the zones file with 20 changed populations matched on its zone codes
Then the import proceeds without a typed change count
```

#### Scenario: The count must be typed back

```gherkin
Given the user has imported 61 zones with their populations
When the user imports the zones file with 21 changed populations matched on its zone codes
Then the import waits for the user to type 21
And a missing or wrong count leaves the import blocked
```

#### Scenario: Changes in different parts count together

```gherkin
Given the user has imported 520 zones with their populations
When the user imports the zones file with 11 changed populations among its first 500 zones and 10 among its last 20 matched on zone codes
Then the import waits for the user to type 21
```

### Requirement: Preview explains protected fields

The re-import preview and check SHALL separately count rows and differing incoming values that keep a person's corrections, and new conflicts. Retained rows may also contain changes to other mapped values; when change history is off, the check SHALL explain that imports overwrite existing values.

#### Scenario: Check a correction

```gherkin
Given the user has imported 61 zones and corrected the first zone's region from North to South
When the user checks a zones file matched on zone codes with a new East region and a changed population for that zone
Then the preview reports 1 changed row and 1 row keeping the user's correction
And it reports 1 changed value, 1 retained value and 1 new conflict
```

#### Scenario: The previous source retains the correction without another conflict

```gherkin
Given the user has imported 61 zones and corrected the first zone's region from North to South
When the user checks the original zones file matched on its zone codes
Then the preview reports 0 changed rows, 61 unchanged rows and 1 row keeping the user's correction
And it reports 1 retained value and 0 new conflicts
```

#### Scenario: No-history overwrites are explained

```gherkin
Given the user has imported 61 zones without change history and corrected the first zone's region
When the user checks the original zones file matched on its zone codes
Then the preview reports the differing region as a change rather than a retained correction
And the user is warned that imports overwrite existing values without change history
```
