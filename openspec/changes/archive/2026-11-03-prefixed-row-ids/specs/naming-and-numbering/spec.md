# Naming and Numbering

## ADDED Requirements

### Requirement: A prefix plus a column names a row

A Table developer SHALL be able to name rows by fixed text followed by one of
the row's own columns, for example PLANT- followed by the plant code. A row
gets that id when it is created, whether from the form, an import or the API.
The column is required, and before the rule is saved its maker sees a sample
id.

#### Scenario: A plant is named after its plant code

```gherkin
Given a table "Plant" whose rows are named "PLANT-" followed by their plant code
When the user adds a plant with the plant code 8151
Then the plant is named PLANT-8151
```

#### Scenario: The builder shows the shape of the id

```gherkin
Given the user is building a table "Plant" with a column "Plant Code"
When the user names its rows "PLANT-" followed by the plant code
Then the builder says ids look like PLANT-‹Plant Code›
```

### Requirement: A value already naming a row is refused by its column

When rows are named after a column, with or without a prefix, a new row whose
value would give an id already in use SHALL be refused, with the column called
out, and the existing row SHALL be left untouched.

#### Scenario: Two plants with the same code

```gherkin
Given plant PLANT-8151 exists
When the user adds another plant with the plant code 8151
Then the save is refused, naming the plant code
And PLANT-8151 is unchanged
```

### Requirement: A changed naming column keeps the id and offers Rename

Changing the column a row is named after SHALL NOT change the row's id. While
the row's id differs from the id its column now gives, the row's form SHALL
say so and offer to rename it to that id.

#### Scenario: A plant's code is corrected

```gherkin
Given plant PLANT-8151 is open
When the user changes its plant code to 8159
Then the plant keeps the id PLANT-8151
And the form offers Rename to PLANT-8159
```
