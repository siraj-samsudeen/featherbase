# Reports and Charts

## ADDED Requirements

### Requirement: Start a script report with its declared filters

A script report SHALL fill its filters with the author's starting values before its first automatic run, including zero and false. Later runs SHALL keep the user's edits and cleared values; opening another report SHALL use that report's own starting values.

#### Scenario: The first answer uses the starting values

```gherkin
Given the Stock Check script report starts with kind "small", quantity zero, enabled false and note "starting note"
When the user opens Stock Check
Then its filters and first answer use those starting values
```

#### Scenario: Cleared values stay cleared

```gherkin
Given the user has opened Stock Check with its starting values
When the user clears the kind and quantity and changes the note to "my choice"
And the user runs Stock Check again
Then kind and quantity stay empty and no longer constrain the answer
And the answer uses note "my choice" rather than "starting note"
```

#### Scenario: Another report has its own starting values

```gherkin
Given the user has opened Stock Check with its starting values
When the user opens Stock Review which starts with kind "large"
Then Stock Review's filters and first answer use its own starting values
```
