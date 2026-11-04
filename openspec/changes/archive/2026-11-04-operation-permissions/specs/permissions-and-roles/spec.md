# Permissions and Roles

## ADDED Requirements

### Requirement: A grant can reach only some columns

A role's grant to read, create or change a table's rows SHALL say which columns it
reaches: every ordinary column, every column including sensitive ones, or only the
columns it lists. The first two keep reaching columns the table gains later; a list
reaches only what it names.

#### Scenario: A detail that may be read but not changed

```gherkin
Given a role may read a quote's title and unit cost but may change only its title
And the user holds that role
When the user changes the title and the unit cost of the quote "Q-1" and saves
Then the save is refused
And the quote "Q-1" keeps its old title and unit cost
```

## MODIFIED Requirements

### Requirement: A column can be marked sensitive

A column SHALL be markable so that only roles with the deeper access it
requires can see, search or change it. Wherever rows are listed, searched,
opened, printed or returned after a save, that column is omitted for
everyone else, and a change to it from them is refused, with nothing in that
change saved. A sensitive column in a row's line items is treated the same
way: it shows to someone whose access to the row, or to the line items
themselves, reaches it.

#### Scenario: A sensitive column is hidden

- **WHEN** a user without the deeper access opens a row that has a sensitive
  column
- **THEN** the column is absent from what they see, not shown blank or
  masked

#### Scenario: A sensitive column in the line items

- **WHEN** a user without the deeper access opens a quote whose lines carry a
  sensitive unit cost, edits a line and saves
- **THEN** no line shows the unit cost, in the form, in the saved reply or in
  print, and the stored unit costs are unchanged
