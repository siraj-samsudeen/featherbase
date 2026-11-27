# Runtime Pages

## ADDED Requirements

### Requirement: Save a screen as a page

A person who may build Tables SHALL be able to save a screen as a page: a description of the parts it is made of, such as a heading, a table and a button. The page SHALL open inside Featherbase as soon as it is saved, with nothing deployed.

#### Scenario: The saved page opens with its heading

```gherkin
Given the user may build Tables
When the user saves a page titled "Reorder Plan" that holds one line of text
Then opening the page shows the heading "Reorder Plan" and that line of text
```

### Requirement: A wrong page is refused and every mistake is named

Featherbase SHALL check a page when it is saved. A page that names a part that does not exist, misspells a setting, or asks for a Table or a column that is not there SHALL be refused, and the refusal SHALL name every mistake at once. Nothing is saved when a page is refused.

#### Scenario: Two mistakes are both named

```gherkin
Given the user may build Tables
When the user saves a page with a part that does not exist and a misspelled setting on another part
Then the save is refused
And the refusal names the part that does not exist
And the refusal names the misspelled setting
And no page is saved
```

#### Scenario: A column the Table does not have is named

```gherkin
Given a Table "Reorder Line" with no column "planed_qty"
When the user saves a page that reads "planed_qty" from "Reorder Line"
Then the save is refused
And the refusal says "Reorder Line" has no column "planed_qty"
```

### Requirement: A page shows rows as the person looking

A page SHALL show the rows of a Table only as far as the person looking at it may read them. Someone who may not read a Table SHALL be told so where its rows would be, and the rest of the page SHALL still show.

#### Scenario: A viewer sees the rows they may read

```gherkin
Given a published page "Reorder Plan" that lists the rows of "Reorder Line"
And a viewer who may read "Reorder Line"
When the viewer opens the page
Then the viewer sees the item "Notebook A5"
```

#### Scenario: A viewer who may not read the Table is told so

```gherkin
Given a published page "Reorder Plan" that lists the rows of "Reorder Line"
And a viewer who may not read "Reorder Line"
When the viewer opens the page
Then the viewer sees the heading "Reorder Plan"
And the viewer is told they may not see those rows
And the viewer does not see the item "Notebook A5"
```

### Requirement: A choice on the page changes what it shows

A page SHALL be able to offer a choice between views, and every part that depends on the choice SHALL follow it at once. The choice SHALL be kept in the page's address, so a copied link opens the page the same way.

#### Scenario: Choosing Value shows values

```gherkin
Given a published page "Reorder Plan" that shows what was sold as a quantity or as a value
When the user chooses "Value"
Then the item "Notebook A5" shows 16,400 sold
And opening the same address again shows "Notebook A5" with 16,400 sold
```

### Requirement: Groups open in place with their totals

A table on a page SHALL be able to group its rows. Each group SHALL show its name and its totals, and opening a group SHALL show its rows directly under it.

#### Scenario: Stationery opens to show its items

```gherkin
Given a published page "Reorder Plan" that groups the rows of "Reorder Line" by category
When the user opens the page
Then the group "Stationery" shows 1,510 sold
And the item "Notebook A5" is not shown
When the user opens the group "Stationery"
Then the item "Notebook A5" is shown under it
```

### Requirement: A page saves a row the way its form does

A page SHALL be able to save a change to a row. The save SHALL go through the same checks as the row's own form, as the person who made it, and a refused save SHALL say why and keep what the person typed.

#### Scenario: Accepting a suggestion saves it

```gherkin
Given a published page "Reorder Plan" where "Gel Pen" has 640 suggested and nothing planned
When the user accepts the suggestion for "Gel Pen"
Then the page says the change was saved
And the row "Gel Pen" of "Reorder Line" has 640 planned
```

#### Scenario: A row someone else changed is not overwritten

```gherkin
Given a published page "Reorder Plan" open on "Gel Pen"
And someone else has since changed the row "Gel Pen"
When the user saves 600 planned for "Gel Pen"
Then the page says why the change was refused
And the box still holds 600
```

### Requirement: Sample rows are marked

A page SHALL be able to carry sample rows of its own, so a screen can be shown before its data exists. Featherbase SHALL mark such a page as showing sample data; the page cannot leave the mark out.

#### Scenario: A page of sample rows says so

```gherkin
Given a published page "Reorder Plan" that shows sample rows of its own
When the user opens the page
Then the page says it shows sample data
And the user sees the item "Notebook A5"
```

### Requirement: A draft is only for people who build

A page SHALL be a draft until it is published. A draft SHALL be open only to people who may build Tables; to anyone else it is not there. A published page SHALL be listed beside the Tables of its group.

#### Scenario: A draft is not there for a viewer

```gherkin
Given a draft page "Reorder Plan"
When a viewer who may not build Tables opens its address
Then the viewer is told nothing is there
```

#### Scenario: A published page is listed with its group's Tables

```gherkin
Given a published page "Reorder Plan" in the group "Reorder"
And a Table "Reorder Line" in the group "Reorder"
When the user opens the group "Reorder"
Then the user sees "Reorder Plan" among its pages and "Reorder Line" among its Tables
```

### Requirement: An agent builds a page through the same door

An agent connected for a person SHALL be able to read which parts a page can be made of, save a page, and read a page back. An agent's page SHALL be checked and refused exactly as a person's is, and an agent SHALL be able to place a Table it makes in a group, beside its pages.

#### Scenario: An agent reads the parts and saves a page

```gherkin
Given an agent connected for a user who may build Tables
When the agent asks which parts a page can be made of
Then the answer includes a table part and an example page
When the agent saves a page titled "Reorder Plan"
Then the agent is given the page's address
And the page is a draft
```

#### Scenario: An agent's wrong page is refused in the same words

```gherkin
Given an agent connected for a user who may build Tables
When the agent saves a page with a part that does not exist
Then the agent is refused
And the refusal names the part that does not exist
```

#### Scenario: An agent places a new Table in a group

```gherkin
Given an agent connected for a user who may build Tables
When the agent makes a Table "Reorder Line" in the group "Reorder"
Then "Reorder Line" is listed in the group "Reorder"
```
