# Asset register

## ADDED Requirements

### Requirement: Keep one register of the group's assets

Each asset SHALL belong to one place (a store, a warehouse or an office) and have a type, and
SHALL get its own tag number when it is added. Every member SHALL be able to see the register.

#### Scenario: An AC in a store

```gherkin
Given Avadi Store is one of the group's places
When a manager adds the "Voltas 2-ton split AC" of type AC to Avadi Store
Then the AC gets a tag number such as AST-0001
And every member sees it in Avadi Store
```

### Requirement: Only managers change the register

Only an Assets Manager SHALL be able to add, change or retire assets, places and asset types.

#### Scenario: Store staff can look but not change

```gherkin
Given the "Voltas 2-ton split AC" is in the register
When store staff try to change its store
Then the change is refused
```

### Requirement: See what needs attention on an asset

The register SHALL show, for each asset, whether it has an open repair job and whether its
warranty ends within the next 30 days.

#### Scenario: A warranty about to end

```gherkin
Given today is 7 November 2026
And the "Kirloskar 62.5 kVA DG" warranty ends on 30 November 2026
Then the register shows its warranty ends soon
```
