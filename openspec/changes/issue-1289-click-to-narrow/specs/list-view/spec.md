## ADDED Requirements

### Requirement: Click To Narrow beside every list

Every list whose filters the person can change SHALL show a Click To Narrow panel left of its rows,
with one list of values for each table its rows reach by links (up to three, each table once,
nearest first), its own rows (unless it is a link table), the far side of each link table pointing
at it, and each Choice column. Each list SHALL be named by its table or column only, with
"<possible> of <total>", and "through <Table>" when more than one link away.

#### Scenario: Lists named by their tables

- **WHEN** the user opens the sections list
- **THEN** the panel lists Store, Floor, Section and Region, Region tagged "through Store"

### Requirement: Every count is live

Each value SHALL show how many of the list's rows reach it under the list's filters and every
other list's picks, not its own. Picked values SHALL read green, possible ones plain, and ones no
row reaches grey at 0, below the rest. A linked list SHALL offer "Not linked to any <Table>".
Counts SHALL include only rows, and name only values, the viewer may read.

#### Scenario: Narrow sections to one store

- **WHEN** the user clicks Northgate in the Store list beside the sections
- **THEN** the list shows Northgate's sections only, Northgate is picked, Bayside stays possible,
  and floors no Northgate section is on show 0, greyed, below the others

#### Scenario: A value the viewer may not read is never named

- **WHEN** a section's floor is one the viewer may not read
- **THEN** that section counts under "Not linked to any Floor", and the floor is never listed

### Requirement: A tick is a Linked to filter

A tick SHALL change the list's filters as Add filter's Linked to does (`related` / `not related`;
`in` / `is blank` for the list's own rows and its Choice values), so it is held in the address and
in saved views and reads as a chip. A pick SHALL read as a green chip ("Store: Bayside") that
removes it. "Not linked to any" SHALL replace the list's other picks, and a value SHALL replace it.

#### Scenario: A pick is in the address

- **WHEN** the user picks Bayside in the Store list
- **THEN** the address holds `["store","related",{"table":"Store","filters":[["row_id","in",[<Bayside>]]]}]`
  and a green chip reads "Store: Bayside"

### Requirement: Long lists stay short

A list SHALL show its top 6 values, picked values first. "Show all N" SHALL open them in a box of
about eight rows that scrolls, never a longer page. A list of more than 12 values SHALL offer
"Find in <Table>", keeping picked values in view while it searches.

#### Scenario: Find a section among many

- **WHEN** the user types "Kiosk" in "Find in Section"
- **THEN** only the sections matching it show, with the picked ones

### Requirement: The panel hides, and opens as a sheet on a phone

The panel SHALL hide and show from the list's tools, remembered per person and Table. On a phone it
SHALL open as a Narrow By sheet from the filter row.

#### Scenario: Hidden stays hidden

- **WHEN** the user hides Click To Narrow and opens the list again
- **THEN** the panel stays hidden
