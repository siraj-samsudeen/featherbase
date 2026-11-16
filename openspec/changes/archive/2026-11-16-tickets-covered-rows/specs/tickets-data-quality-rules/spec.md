## ADDED Requirements

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
