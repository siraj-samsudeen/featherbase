# Tickets data quality rules

## Purpose
A master-data gap that one filter describes, such as every buyer whose person is blank, is one rule on its ticket
with a live count of the rows still to fix, instead of one row per blank. The ticket shows how far the fix has
got, links to exactly the rows left, and reads all clear when none are.

## Requirements

### Requirement: A gap that a filter describes is one rule with a live count
A ticket SHALL carry data quality rules. A rule names one Table, its filter conditions, a severity (High,
Medium or Low), an owner and how to fix it. Tickets SHALL keep how many rows matched when the rule was added,
and SHALL count the rows that match now each time the ticket is read, as the reader. A rule that matches
no rows SHALL read as all clear, and SHALL count again if rows match later.

#### Scenario: A rule counts the rows it describes

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
And the linked Table "Buyer Assignment" has 3 buyer rows whose person is blank
When Bala adds the rule "Buyer is blank" on "Buyer Assignment" where role is "Buyer" and person is blank
Then the ticket shows "Buyer is blank" with 3 of 3 rows left
```

#### Scenario: Fixing the rows makes a rule all clear

```gherkin
Given a ticket with the rule "Buyer is blank" and 3 of 3 rows left
When a person is filled in on one of those rows
Then the rule has 2 of 3 rows left
And when the other two are filled in, the rule is all clear
```

#### Scenario: A row that matches again brings the count back

```gherkin
Given a ticket whose rule "Buyer is blank" is all clear
When a new buyer row is added with no person
Then the rule has 1 of 3 rows left
```

### Requirement: Only the live count follows the Table's read permission
How many rows a rule matched when it was raised SHALL be part of the ticket's record, readable by everyone who
reads the rule, like the ticket's own words. How many rows match now SHALL be counted only for a reader who may
read the rule's Table; anyone else SHALL see no live count.

#### Scenario: Colleague reads when the rule was raised, not what is left

```gherkin
Given a ticket with the rule "Buyer is blank" and 3 of 3 rows left
When Colleague, who may not read "Buyer Assignment", opens the ticket
Then Colleague sees the rule was raised with 3 rows
And Colleague sees no count of the rows left
```

### Requirement: A rule is checked when it is added
Only someone involved in the ticket SHALL add a rule: its raiser, its assignee or Tickets support. A rule
SHALL be refused when its Table is not listed in Tickets' linked Tables, when a condition names a column the
Table does not have, when it matches no rows, or when the ticket already has 25 rules.

#### Scenario: A rule on a Table that is not linked is refused

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
When Bala adds a rule on a Table that is not linked to Tickets
Then the rule is refused as not on a linked Table
```

#### Scenario: A rule that matches nothing is refused

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
And the linked Table "Buyer Assignment" has 3 buyer rows whose person is blank
When Bala adds a rule where role is "Category head" and person is blank
Then the rule is refused as matching no rows
```

#### Scenario: A rule on a column the Table lacks is refused

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
When Bala adds a rule on "Buyer Assignment" where "shoe size" is blank
Then the rule is refused, naming "shoe size"
```

#### Scenario: Someone not involved in the ticket cannot add a rule

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
When Colleague adds the rule "Buyer is blank"
Then the rule is refused
```

### Requirement: A rule is removed with a reason
Someone involved in the ticket SHALL remove a rule only with a reason, and the removal, with its reason,
SHALL be kept in the ticket's history. A rule is changed by removing it and adding a new one.

#### Scenario: Bala removes a rule

```gherkin
Given a ticket with the rule "Buyer is blank" and 3 of 3 rows left
When Bala removes it because "Raised on the wrong ticket"
Then the ticket has no rules
And its history shows the rule removed because "Raised on the wrong ticket"
```

### Requirement: The ticket page shows its rules
A ticket with rules SHALL show them on its page: open rules first, then by severity, each with its title,
Table and how many rows are left of how many matched when it was added, or all clear. Each counted rule SHALL
link to its Table's list showing exactly the matching rows. The rules SHALL be shown as a list, a table or
tiles, chosen on the page and remembered in that browser. While any rule has rows left, the next step SHALL
say how many rules still have rows to fix, without stopping the step.

#### Scenario: Bala sees the open rule first

```gherkin
Given a ticket with the rules "Buyer is blank" (Medium, 3 of 3 rows left) and "Store is blank" (High, all clear)
When Bala opens the ticket
Then the Rules card lists "Buyer is blank" before "Store is blank"
And it reads "3 rows still to fix"
```

#### Scenario: A rule links to its matching rows

```gherkin
Given a ticket with the rule "Buyer is blank" and 3 of 3 rows left
When Bala opens the ticket
Then "Open these rows" points to the "Buyer Assignment" list filtered to role "Buyer" and person blank
```

#### Scenario: Bala adds a rule from the ticket page

```gherkin
Given Anjali raised a Data Quality Issue for SAP, assigned to Bala
And the linked Table "Buyer Assignment" has 3 buyer rows whose person is blank
When Bala picks "Buyer Assignment", role is "Buyer" and person is blank on the ticket page
Then the page says it matches 3 rows
And when Bala saves it as "Buyer is blank", the Rules card shows it
```

#### Scenario: The rules can be shown as a table or tiles

```gherkin
Given a ticket with the rule "Buyer is blank" and 3 of 3 rows left
When Bala switches the Rules card to "Tiles"
Then the rule is shown as a tile
And the ticket page opens with tiles next time
```

#### Scenario: The next step warns while rules have rows to fix

```gherkin
Given a ticket with the rule "Buyer is blank" and 3 of 3 rows left
When Bala opens the ticket
Then the next step says "1 rule still has rows to fix"
```

### Requirement: The ticket page lists the rows it covers
A ticket that the instance's Data Quality Row Table names SHALL list those rows on its Request tab to everyone
who can see the ticket, under a count of how many there are and how many are fixed. Each row SHALL show its
Table, the row, what is wrong, and whether it is fixed (with the day) or open; open rows come first. A row and its
status SHALL link to the affected record and to its Data Quality Row record, each only for a viewer who may
read it; for anyone else they SHALL be plain text.

#### Scenario: Everyone who can see the ticket sees the rows it covers

```gherkin
Given Anjali's Data Quality Issue covers 3 rows, one fixed on 07-Nov-2026
When Anjali, Bala or Colleague opens the ticket
Then each sees the same 3 rows, the open ones first
And the list reads "3 rows · 1 fixed"
```

#### Scenario: A row links to its record only for someone who may read it

```gherkin
Given Anjali's Data Quality Issue covers the Section "North Grocery", which only Tickets support may read
When Bala opens the ticket
Then "North Grocery" links to its Section record
And when Anjali opens the ticket, "North Grocery" is plain text
```

### Requirement: Tickets reads only the covered rows it shows
Tickets SHALL read the Data Quality Row Table only for the columns it shows, only the rows of the ticket being
opened, and only after the viewer has read that ticket. Until an administrator lists Data Quality Row among
Tickets' linked Tables, the page SHALL open without the list.

#### Scenario: Until Data Quality Row is a linked Table the page opens without the list

```gherkin
Given Data Quality Row is not among Tickets' linked Tables
When Anjali opens her Data Quality Issue
Then the page opens without the rows it covers
And Bala, of Tickets support, is told to list Data Quality Row in linked_tables
```

### Requirement: The ticket page leads with the ticket's own words and links its people
The Request tab SHALL show the ticket's original message first, before the rows it covers, its rules and its
public progress. The person who raised the ticket and the person it is assigned to SHALL be shown by name and
link to their Person record for a viewer who may read it.

#### Scenario: Support reads the message before the rows

- **WHEN** someone who may read a data quality ticket's message opens it
- **THEN** its original message is the first thing on the Request tab, and the raiser's name links to their record only if they may read Person
