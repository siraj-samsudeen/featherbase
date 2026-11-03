# Tables and Fields

## ADDED Requirements

### Requirement: Rename a custom Table and keep what it holds

A System Manager SHALL be able to rename a Table made in the builder or by an
import. Its rows and everything that names the Table SHALL move to the new
name together, and a later re-import SHALL keep the edits people made before
the rename. Platform, app and data-source Tables keep their names.

#### Scenario: A corrected plant keeps its correction and history

```gherkin
Given a table "SAP Plant" whose plant 8151 a person corrected to "Chennai"
When the System Manager renames the table to "Plant"
Then plant 8151 of "Plant" reads "Chennai", with the correction in its history
And importing the source again keeps "Chennai"
```

### Requirement: A renamed Table's old name says where it went

The old name and address of a renamed Table SHALL say what the Table is now
called, who renamed it and when, and link to it.

#### Scenario: The old address says where the Table went

```gherkin
Given the table "SAP Plant" was renamed to "Plant"
When the user opens the old address of "SAP Plant"
Then the page says "SAP Plant is now called Plant" and links to "Plant"
```
