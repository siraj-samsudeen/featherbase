## REMOVED Requirements

### Requirement: Choose this month or last month

**Reason**: Its "A Dive that can't show last month" scenario guarded a pinned Dive version. The latest Dive always shows the month it is given, so the pin and the fallback are gone (#937).
**Migration**: Carried over below as "Choose this month or last month, in the interactive report too", with last month opening the interactive report.

## ADDED Requirements

### Requirement: The interactive report is the latest saved Dive

The page SHALL open the latest saved version of the instance's Dive, without naming a version, so saving a new version of the Dive is what releases it to readers. No instance setting SHALL pin a Dive version.

#### Scenario: A new Dive version is saved

- **WHEN** the Dive's owner saves a new version of the Dive on MotherDuck
- **THEN** the next reader who opens the report sees that version, with no change to the app or its settings

### Requirement: Choose this month or last month, in the interactive report too

The report SHALL let the reader choose this month, from the first through today in India Standard Time, or last month, from its first day through its last. This month SHALL be the default. The choice SHALL be kept in the page's address, and SHALL keep meaning "this month" or "last month" as the calendar moves on. No earlier month SHALL be offered.

#### Scenario: Last month's result early in the next month

- **WHEN** a reader opens the report on 2 November and chooses last month
- **THEN** they see October's targets and sales for 1 to 31 October, limited to their own subcategories as this month's are

#### Scenario: Last month in the interactive report

- **WHEN** a reader chooses last month and the interactive report is set up
- **THEN** the interactive report opens on last month's dates, ending on its last day

#### Scenario: Last month's copy not ready

- **WHEN** a reader chooses last month and the cached copy still holds the month before it
- **THEN** the page says last month's figures aren't ready yet, and nothing reads as zero sales
