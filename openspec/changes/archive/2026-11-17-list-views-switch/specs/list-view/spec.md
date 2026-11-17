## ADDED Requirements

### Requirement: A list can be read in three views

A Table's list SHALL offer three views, switched by three buttons beside its title: Table, where a row opens the record's own page; List And Record, where cards stand on the left and the open record beside them; and Table With Panel, where the table stays whole and the open record slides over its right side. List And Record and Table With Panel SHALL show the same record panel.

#### Scenario: Reading a record beside the list

```gherkin
Given the user opens the Job Assignment list
When the user switches it to List And Record and chooses Anitha's card
Then Anitha's record shows beside the cards
And the cards stay where they were
```

#### Scenario: The panel over the table

```gherkin
Given the user opens the Job Assignment list in Table With Panel
When the user chooses Anitha's row and presses the down arrow
Then the next row's record shows in the panel
And pressing Escape closes the panel with that row still marked
```

### Requirement: Each person's view of a list is remembered

The view a person chooses SHALL be remembered for them on that Table, across sign-ins. A Table with no choice yet SHALL open on Table With Panel, or on List And Record when the Table is marked as a queue. At phone width the list SHALL show as Table.

#### Scenario: Back to the same view

```gherkin
Given the user switched the Department list to List And Record
When the user signs out, signs back in and reopens that list
Then it opens in List And Record
```

#### Scenario: A queue opens on its cards

```gherkin
Given a Table is marked as a queue and the user has never chosen a view for it
When the user opens its list
Then it opens in List And Record
```

### Requirement: The open record is in the address

The record open in a list's panel SHALL be part of the page's address, so going back, reloading or opening a copied link SHALL show the same list with the same record open.

#### Scenario: A pasted link opens the record beside its list

```gherkin
Given the user copies the address while Anitha's record is open beside the Job Assignment list
When a colleague who can read Job Assignment opens that address
Then they see the Job Assignment list with Anitha's record open
```
