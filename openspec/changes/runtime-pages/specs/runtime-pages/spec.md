# Runtime Pages

## ADDED Requirements

### Requirement: Save a screen as a page

A person who may build Tables SHALL be able to save a screen as a page: a description of the parts it is made of, where a part is one building block such as a heading, a table or a button. The page SHALL open inside Featherbase as soon as it is saved, with nothing deployed. Anyone else SHALL be refused.

#### Scenario: The saved page opens with its heading

```gherkin
Given the user may build Tables
When the user saves a page titled "Reorder Plan" that holds one line of text
Then opening the page shows the heading "Reorder Plan" and that line of text
```

#### Scenario: Someone who may not build is refused

```gherkin
Given a viewer who may not build Tables
When the viewer saves a page titled "Reorder Plan"
Then the save is refused
And no page is saved
```

### Requirement: A wrong page is refused and every mistake is named

Featherbase SHALL check a page when it is saved. A page that names a part or an action Featherbase does not offer, misspells a setting, or asks for a Table or a column that is not there SHALL be refused, and the refusal SHALL name every mistake at once.

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

A page SHALL show the rows of a Table only as far as the person looking at it may read them.

#### Scenario: A viewer sees the rows they may read

```gherkin
Given a published page "Reorder Plan" that lists the rows of "Reorder Line"
And a viewer who may read "Reorder Line"
When the viewer opens the page
Then the viewer sees the item "Notebook A5"
```

### Requirement: Rows a person may not read leave the rest of the page standing

Where a page would show rows its viewer may not read, the page SHALL say so in their place and still show everything else.

#### Scenario: The heading shows without the rows

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

#### Scenario: Sold shows as a value

```gherkin
Given a published page "Reorder Plan" that shows what was sold as a quantity or as a value
When the user chooses to see it as a value
Then the item "Notebook A5" shows 16,400 sold
And opening the same address again shows "Notebook A5" with 16,400 sold
```

### Requirement: Groups open in place with their totals

A table on a page SHALL be able to group its rows. Each group SHALL show its name and its totals, and opening a group SHALL show its rows directly under it. Which group is open SHALL be kept in the page's address.

#### Scenario: Stationery opens to show its items

```gherkin
Given a published page "Reorder Plan" that groups the rows of "Reorder Line" by category
When the user opens the page
Then the group "Stationery" shows 1,510 sold
And the item "Notebook A5" is not shown
When the user opens the group "Stationery"
Then the item "Notebook A5" is shown under it
And opening the same address again shows "Notebook A5"
```

### Requirement: A page saves a row as the person who made the change

A page SHALL be able to save a change to a row. The save SHALL go through the row's own checks, as the person who made it. What a person types SHALL change nothing until they save, and SHALL be kept when a save is refused.

#### Scenario: Notebook A5 shows 760 planned

```gherkin
Given a published page "Reorder Plan" where "Notebook A5" has 760 suggested and nothing planned
When the user accepts the suggestion for "Notebook A5"
Then the page says the change was saved
And the row "Notebook A5" of "Reorder Line" has 760 planned
```

#### Scenario: Typing alone changes nothing

```gherkin
Given a published page "Reorder Plan" where "Notebook A5" has nothing planned
When the user types 700 planned for "Notebook A5" and does not save
Then the row "Notebook A5" of "Reorder Line" still has nothing planned
```

#### Scenario: A viewer who may not change the row is told so

```gherkin
Given a published page "Reorder Plan" where "Notebook A5" has nothing planned
And a viewer who may read "Reorder Line" but not change it
When the viewer saves 700 planned for "Notebook A5"
Then the page says the viewer may not change it
And the page still holds the 700 the viewer typed
And the row "Notebook A5" of "Reorder Line" still has nothing planned
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

A page SHALL be a draft until it is published. A draft SHALL be open only to people who may build Tables. To anyone else a draft is not there, exactly as an address with no page is not there.

#### Scenario: A draft is not there for a viewer

```gherkin
Given a draft page "Reorder Plan"
When a viewer who may not build Tables opens its address
Then the viewer is told nothing is there
```

#### Scenario: An address with no page says nothing is there

```gherkin
Given no page named "Reorder Plan"
When the user opens the address a page of that name would have
Then the user is told nothing is there
```

### Requirement: A page is listed with its group

A published page SHALL be listed in its group, where that group's Tables are. People who may build SHALL also find the group's drafts there, marked as drafts.

#### Scenario: A published page is listed in its group

```gherkin
Given a published page "Reorder Plan" in the group "Reorder"
When the user opens the group "Reorder"
Then the user sees "Reorder Plan" among the group's pages
```

#### Scenario: A builder sees the group's draft, marked

```gherkin
Given a draft page "Reorder Plan" in the group "Reorder"
When the user, who may build Tables, opens the group "Reorder"
Then the user sees "Reorder Plan" among the group's pages, marked as a draft
```

### Requirement: An agent builds a page through the same door

An agent connected for a person SHALL be able to read which parts a page can be made of, save a page and read it back. An agent's page is checked and refused exactly as a person's is.

#### Scenario: An agent reads the parts and saves a page

```gherkin
Given an agent connected for a user who may build Tables
When the agent asks which parts a page can be made of
Then the answer includes a table part and an example page
When the agent saves a page titled "Reorder Plan"
Then the agent is given the page's address
And the page is a draft
```

### Requirement: An agent files a new Table in a group

An agent SHALL be able to say which group a Table it makes belongs to, so the Table is found beside that group's pages.

#### Scenario: An agent's new Table is listed in its group

```gherkin
Given an agent connected for a user who may build Tables
When the agent makes a Table "Reorder Line" in the group "Reorder"
Then "Reorder Line" is listed in the group "Reorder"
```
