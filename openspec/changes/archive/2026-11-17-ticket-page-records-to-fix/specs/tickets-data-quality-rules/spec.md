## MODIFIED Requirements

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
And the list reads "3 records · 1 fixed"
```

#### Scenario: A row links to its record only for someone who may read it

```gherkin
Given Anjali's Data Quality Issue covers the Section "North Grocery", which only Tickets support may read
When Bala opens the ticket
Then "North Grocery" links to its Section record
And when Anjali opens the ticket, "North Grocery" is plain text
```
