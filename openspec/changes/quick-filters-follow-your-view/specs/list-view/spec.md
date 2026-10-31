# List View

## MODIFIED Requirements

### Requirement: Narrow the list with filters

The user SHALL be able to add a filter on any column that holds a value, and every filter added SHALL narrow the list
further; each filter in use is shown and can be removed on its own.

#### Scenario: Add and remove a filter

```gherkin
Given the list of "Section Mapping"
When the user filters "Status" to "Open"
Then only Open rows show
When the user removes that filter
Then every row shows again
```

#### Scenario: Use a quick filter

```gherkin
Given the list of "Section Mapping" with Status showing
When the user picks "Closed" in the quick filter for Status
Then only Closed rows show, and the filter shows as in use
When the user picks "All"
Then every row shows again
```

## ADDED Requirements

### Requirement: Quick filters follow the columns you see

A quick filter is a box above the list for narrowing it in one step. Each column in the user's own view SHALL have one
if its kind of value can take one, in the same order as the list's columns.

#### Scenario: Remarks gets a quick filter when it is switched on

```gherkin
Given the list of "Section Mapping" with Remarks not showing
When the user switches on Remarks
Then a quick filter for Remarks appears, in Remarks' place among the columns
```

#### Scenario: Floor's quick filter goes when Floor is switched off

```gherkin
Given the list of "Section Mapping" with Floor showing
When the user switches off Floor
Then the quick filter for Floor is gone
```

#### Scenario: A filter on a hidden column stays on

```gherkin
Given the user has filtered Floor to "Ground" in the list of "Section Mapping"
When the user switches off Floor
Then the list still shows only Ground rows
And the filter still shows as in use, and removing it brings every row back
```

#### Scenario: A date column has no quick filter

```gherkin
Given the list of "Section Mapping" with its Audited On date showing
When the user looks above the list
Then there is no quick filter for Audited On
And the user can still add a filter on it
```

### Requirement: A quick filter suits its column

A quick filter SHALL match the kind of value in its column: words are searched, and a column with set choices or a
yes or no answer offers those to pick from.

#### Scenario: Typing part of a word finds the Owner

```gherkin
Given the list of "Section Mapping" with Owner showing
When the user types "asha" in the quick filter for Owner
Then only rows whose Owner contains "asha" show
```

#### Scenario: A yes or no column offers yes and no

```gherkin
Given the list of "Section Mapping" with its Active column showing
When the user picks yes in the quick filter for Active
Then only active rows show
When the user picks no
Then only inactive rows show
```

### Requirement: Filtering a yes or no column finds its rows

A filter on a yes or no column SHALL match by yes or no however it was added, and the user picks yes or no rather than
typing it. A value that is neither SHALL be refused with a clear message, so a filter never quietly finds nothing.

#### Scenario: An added filter on Active finds the active rows

```gherkin
Given the list of "Section Mapping" with active and inactive rows
When the user adds a filter on Active and picks yes
Then only active rows show
And the filter in use reads yes
```

#### Scenario: A link saying Active is true finds the active rows

```gherkin
Given a link to the list of "Section Mapping" whose filter says Active is "true"
When the user opens it
Then only active rows show
```

#### Scenario: A link saying Active is maybe is refused

```gherkin
Given a link to the list of "Section Mapping" whose filter says Active is "maybe"
When the user opens it
Then the user is told that filter's value is not yes or no
```

### Requirement: Many quick filters stay out of the way

The list SHALL show up to six quick filters, and say how many more there are, which open in place on request. A quick
filter holding a value SHALL never fold away, even if that means showing more than six.

#### Scenario: Six quick filters show and two more wait

```gherkin
Given the user's view of "Section Mapping" has eight columns that can take a quick filter
When the user opens the list
Then six quick filters show, and the list says there are 2 more
When the user asks to see them
Then all eight show without leaving the list
```

#### Scenario: The eighth quick filter stays showing while it holds a value

```gherkin
Given the user's view of "Section Mapping" has eight columns that can take a quick filter
And a link to the list has a value in the eighth quick filter
When the user opens that link
Then the first six quick filters show, and so does the eighth, holding that value
And the list says there is 1 more
```
