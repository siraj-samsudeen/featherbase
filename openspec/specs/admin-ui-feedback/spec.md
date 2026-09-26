# Admin UI Feedback Specification

## Purpose

Admin UI Feedback covers Admin behavior that doesn't belong to a more
specific capability: how the search bar opens what it matches, how a user's
theme and colour palette follow them, and how turning on a data source's
table completes its foreign keys into References. Building a table from a
dropped file is covered by Tables and Fields; recent search history and
Explore are covered by Search and Explore; language preference is covered by
Personal Preferences; and browsing what a data source holds is covered by
External Data Sources.

## Requirements

### Requirement: The search bar opens what it finds

Searching from anywhere in the Admin SHALL offer the Tables, commands and
records that match, plus a way to start a new row in a matching Table, and
opens whichever one the user picks.

#### Scenario: A record and a Table both match

- **WHEN** a user searches a record's name and then a Table's name
- **THEN** picking the record opens its form, and picking the Table's
  new-row result opens a blank form for that Table

### Requirement: Theme and colour palette follow the user, not the device

Choosing a theme or colour palette SHALL apply it right away and save it to
the user's own account, so it's there again the next time they sign in on
any device — without ever showing another account's choice on a shared
browser.

#### Scenario: Two choices, two accounts

- **WHEN** a user picks Ivory and dark mode and then reloads the page
- **THEN** both choices are still active, and signing in as a different
  user shows that user's own theme and palette instead

### Requirement: Turning on a source table completes matching foreign keys into References

When a builder turns one of a data source's tables into a Featherbase
table, a column the source declares as a foreign key SHALL become a
Reference once its target table has also been turned on with a matching id
column — whichever of the two tables is turned on first.

#### Scenario: The target arrives after the child

- **WHEN** a table is turned on before the table its foreign key points to,
  and that target is turned on afterwards
- **THEN** the first table's column becomes a Reference to the target once
  it arrives, with no need to turn the first table on again
