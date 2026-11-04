## ADDED Requirements

### Requirement: Choose this month or last month

The report SHALL let the reader choose this month, from the first through today in India Standard Time, or last month, from its first day through its last. This month SHALL be the default. The choice SHALL be kept in the page's address, and SHALL keep meaning "this month" or "last month" as the calendar moves on. No earlier month SHALL be offered.

#### Scenario: Last month's result early in the next month

- **WHEN** a reader opens the report on 2 November and chooses last month
- **THEN** they see October's targets and sales for 1 to 31 October, limited to their own subcategories as this month's are

#### Scenario: A Dive that can't show last month

- **WHEN** a reader chooses last month and the interactive report pinned for the instance always shows the latest month
- **THEN** the page shows last month's cached table and says the interactive report can't show last month yet, never the latest month under last month's dates

#### Scenario: Last month's copy not ready

- **WHEN** a reader chooses last month and the cached copy still holds the month before it
- **THEN** the page says last month's figures aren't ready yet, and nothing reads as zero sales
