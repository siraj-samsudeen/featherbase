# Admin UI Feedback

## ADDED Requirements

### Requirement: Choose a search result with the keyboard

Plain Down and Up SHALL move forward and backward through selectable command-bar results in displayed order across groups, with a visible and accessible indication of the choice; Enter SHALL activate that choice. Choosing a past search SHALL leave it editable; choosing a destination SHALL retain the existing dismissal behavior. Escape SHALL close the dropdown and allow reopening. Modified arrows SHALL retain their native editing behavior.

#### Scenario: A new-row choice opens its form

```gherkin
Given the user is searching for Person in the command bar
When the user chooses the new Person row result using the arrow keys and Enter
Then a blank Person form is shown without the command dropdown
```

#### Scenario: A record choice opens its form

```gherkin
Given the user is searching for Person in the command bar
When the user chooses the Person definition record using the arrow keys and Enter
Then the Person definition form is shown without the command dropdown
```

### Requirement: Replacing a search cannot activate its previous records

While a replacement search is being resolved, the command bar SHALL NOT offer or activate records belonging only to the previous search.

#### Scenario: A replaced search does not reopen the old record

```gherkin
Given the user is searching for Person in the command bar
When the user replaces the search with Sign In Meth and immediately activates the search
Then the previous Person record is not opened
```

## MODIFIED Requirements

### Requirement: The search bar opens what it finds

Searching from anywhere in the Admin SHALL offer the Tables, commands and
records that match, plus a way to start a new row in a matching Table, and
opens whichever one the user picks. When no result has been explicitly chosen,
pressing Enter opens the Table whose name was typed exactly, and otherwise
the first matching record.

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

### Requirement: Search results say what each one opens

Search results SHALL tell commands, Table lists, new-row actions and records
apart, with a heading or self-describing text. A Table result names its
module and says it opens the list; a record result names the Table it
belongs to; a new-row action is never labelled like the command to create a
Table. Clicking any result goes where it always did. Without an explicitly
chosen result, Enter opens an exactly named Table's list before considering records.

#### Scenario: One word, four kinds of result

- **WHEN** the user searches for a word that is a command, a Table, a new-row
  action and a record all at once, without explicitly choosing a result
- **THEN** the four are distinguishable, and Enter opens the Table's list
