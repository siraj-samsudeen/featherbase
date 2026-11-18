## MODIFIED Requirements

### Requirement: The search bar opens what it finds

Searching from anywhere in the Admin SHALL offer the Tables, commands and
records that match, plus a way to start a new row in a matching Table, and
opens whichever one the user picks.

#### Scenario: A record and a Table both match

- **WHEN** a user searches a record's name and then a Table's name
- **THEN** picking the record opens its form, and picking the Table's
  new-row result opens a blank form for that Table

#### Scenario: Run a command

- **WHEN** a user types part of a command's name, such as going to the Admin
  home, and picks it
- **THEN** the command runs

## ADDED Requirements

### Requirement: Enter opens the first result shown

When no result has been explicitly chosen, pressing Enter in the command bar
SHALL open the Table or page whose name was typed exactly, and otherwise the
first result shown, in the list's order: commands, pages, Tables, new rows,
records. Pressed while results are still arriving, Enter SHALL wait for them;
with no match it stays where it is. Enter SHALL NOT open an address guessed
from the typed words (#1325).

#### Scenario: Enter on a Table's name

- **WHEN** a user types a Table's exact name and presses Enter without explicitly choosing another result
- **THEN** that Table's list opens

#### Scenario: A page is shown before a record

- **WHEN** a user types words that name a page and a record, and presses Enter without choosing a result
- **THEN** the page opens

#### Scenario: Enter on words that match nothing

- **WHEN** a user types words that match nothing and presses Enter
- **THEN** the page stays where it was, and the bar says nothing matched

### Requirement: The account menu's pages are found

The command bar SHALL find the account menu's pages by their menu names:
What you can see, and Service accounts for a System Manager. Log out SHALL be
a command (#1325).

#### Scenario: The account menu's pages are found

```gherkin
Given the user manages the instance
When the user finds Service accounts through the command bar
Then Access tokens is shown on its Service accounts tab
```
