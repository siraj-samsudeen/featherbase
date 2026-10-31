# Usable on Any Device

## MODIFIED Requirements

### Requirement: Lists fit a phone

The rows of a list SHALL be readable on a phone without scrolling sideways, each row showing its most important
details stacked. A row shows at most three of its listed columns, and says how many more it has, which open in place
on request.

#### Scenario: Read a list of checklist runs on a phone

```gherkin
Given the user is on a phone
When the user opens a list
Then each row shows its title, its status in words and its key figures, without sideways scrolling
```

#### Scenario: Work with a Table's rows on a phone

```gherkin
Given the user is on a phone
When the user opens any Table's list
Then each row is a card led by the row's title, which opens the row, never by an opaque id
And the card shows its status in words and up to three other listed columns as labelled figures
And the user can still select rows one at a time or all on the page, and act on them in bulk
And the user can sort by any listed column, show a row's nested rows in place, and page through the rows
```

#### Scenario: Section Mapping's cards show three columns and the rest on request

```gherkin
Given the user is on a phone
And the table "Section Mapping" has seven list columns
When the user opens its list
Then each card is titled by its Section and shows three of the other six columns
And it says there are 3 more
When the user asks to see them
Then the card shows all seven without leaving the list
```
