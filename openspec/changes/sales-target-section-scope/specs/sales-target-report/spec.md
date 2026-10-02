# Sales Target Report Delta

## ADDED Requirements

### Requirement: Team Leaders see the Sections they lead

A Section is an area of a store's floor, such as Kurti or Home Décor, that holds a set of subcategories. A Team Leader SHALL see every subcategory of every Section that the store's staff roster names them as leading.

#### Scenario: Team Leader opens the report

- **WHEN** a Team Leader whose Section holds ninety subcategories opens the report
- **THEN** all ninety subcategories are shown, not only the few rostered to them personally

### Requirement: Department Managers see the Sections they manage

A Department Manager SHALL see every subcategory of every Section that the roster names them as managing.

#### Scenario: Department Manager opens the report

- **WHEN** a Department Manager who manages six Sections opens the report
- **THEN** the subcategories of all six Sections are shown

### Requirement: Personal subcategories still count

A reader SHALL also see the subcategories rostered to them personally and any assigned to them directly, in addition to the Sections they lead or manage.

#### Scenario: Leader also rostered on another subcategory

- **WHEN** a Team Leader is also rostered on a subcategory outside their Section
- **THEN** that subcategory is shown along with their Section

### Requirement: The roster is read as of today, Section by Section

Who leads or manages a Section SHALL be decided by that Section's most recent roster entry dated on or before today, so a handover changes only the Section handed over.

#### Scenario: A Section changes hands

- **WHEN** one Section gets a new Team Leader from a given day
- **THEN** from that day the new Team Leader sees it and the previous one does not, while every other Section keeps its leader

### Requirement: Month to date in India time

The report SHALL cover the current month from the first through today in India Standard Time, and SHALL move to the new month at midnight India time.

#### Scenario: First day of the month

- **WHEN** a reader opens the report just after midnight on the 1st, India time
- **THEN** the report covers the new month, never the previous one

### Requirement: Say when the month has no data yet

When the warehouse has not yet recorded any day of the current month, the report SHALL say so instead of showing empty figures.

#### Scenario: Early on the 1st

- **WHEN** a reader opens the report on the 1st before that morning's sales have loaded
- **THEN** they are told no sales are recorded for the month yet, and nothing reads as zero sales

### Requirement: Subtotals by Section

The report SHALL group subcategories under their Section with a subtotal for each, and SHALL show subcategories that belong to no Section after the named ones.

#### Scenario: Reader with two Sections

- **WHEN** a reader who leads Home Décor and Stationery opens the report
- **THEN** each Section has its own subtotal, and together they add up to the report total

### Requirement: Say why the reader sees these figures

The report SHALL tell the reader every reason they see it, such as leading a Section or being rostered on a subcategory.

#### Scenario: Leader who is also rostered on subcategories

- **WHEN** a Team Leader who is also rostered on some subcategories opens the report
- **THEN** the report gives both reasons

### Requirement: One report on the page

When the live report is available, it SHALL be the report the reader sees. The cached table SHALL be folded away behind a line that says it is the cache and when it was refreshed, and SHALL be shown open only when the live report is not there.

#### Scenario: Live report available

- **WHEN** a reader opens the report and the live report loads
- **THEN** they see one set of figures, and the cached table is folded away under a line giving its refresh time
