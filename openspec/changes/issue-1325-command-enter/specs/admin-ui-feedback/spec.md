## MODIFIED Requirements

### Requirement: Find every permitted destination

The Admin search SHALL find every independently openable page and Table available to the user by its readable name, including settings, visible Home Pages, installed available apps and their declared tabs. It SHALL find the account menu's pages by their menu names: What you can see, and Service accounts for a System Manager; Log out SHALL be a command (#1325). It SHALL distinguish destination kinds, avoid duplicate destinations and omit unavailable destinations, child Tables and choices requiring an existing selection.

#### Scenario: Instance health opens from search

```gherkin
Given the user manages the instance
When the user finds Instance health through the command bar
Then the instance health page is shown without the command dropdown
```

#### Scenario: Settings opens its existing form

```gherkin
Given the user manages the instance
When the user finds System Settings through the command bar
Then the existing System Settings form is shown
```

#### Scenario: Unavailable pages are absent

```gherkin
Given the user can read Person but cannot manage the instance
When the user searches for Instance health through the command bar
Then Instance health is not offered
```

#### Scenario: The account menu's pages are found

```gherkin
Given the user manages the instance
When the user finds Service accounts through the command bar
Then Access tokens is shown on its Service accounts tab
```

### Requirement: The search bar opens what it finds

Searching from anywhere in the Admin SHALL offer the Tables, commands and
records that match, plus a way to start a new row in a matching Table, and
opens whichever one the user picks. When no result has been explicitly chosen,
pressing Enter opens the Table or page whose name was typed exactly, and
otherwise the first result shown, in the list's order: commands, pages,
Tables, new rows, records. Pressed while results are still arriving, Enter
waits for them; with no match it stays where it is. Enter SHALL NOT open an
address guessed from the typed words (#1325).

#### Scenario: A record and a Table both match

- **WHEN** a user searches a record's name and then a Table's name
- **THEN** picking the record opens its form, and picking the Table's
  new-row result opens a blank form for that Table

#### Scenario: Enter on a Table's name

- **WHEN** a user types a Table's exact name and presses Enter without explicitly choosing another result
- **THEN** that Table's list opens

#### Scenario: Run a command

- **WHEN** a user types part of a command's name, such as going to the Admin
  home, and picks it
- **THEN** the command runs

#### Scenario: A page is shown before a record

- **WHEN** a user types words that name a page and a record, and presses Enter without choosing a result
- **THEN** the page opens

#### Scenario: Enter on words that match nothing

- **WHEN** a user types words that match nothing and presses Enter
- **THEN** the page stays where it was, and the bar says nothing matched
