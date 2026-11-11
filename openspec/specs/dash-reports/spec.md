# Dash Reports

## Purpose

Dash opens the warehouse's reports, each a MotherDuck Dive, for the people who work in the stores. Each reader sees only what their current job reaches: their section, their floor, their store, their cluster or every store. Dash tells each report only which stores and subcategories to show, and refuses a report it can't narrow to the reader rather than show more.

## Requirements

### Requirement: The reader is offered the reports they can open
Dash SHALL list, by name, each report the reader can open, and SHALL open the first of them when none is named. A report covering whole stores SHALL NOT be offered to someone whose job reaches no whole store.

#### Scenario: A Team Leader's reports

- **WHEN** a Team Leader of one section opens Dash
- **THEN** they are offered the sales report and the vendor report, not the whole-stores report, and the sales report opens

### Requirement: Each report shows only the choices it takes
A store choice SHALL appear only on a report that takes one store, listing the reader's stores by name. A month choice SHALL appear only on a report that takes a month. Moving between reports SHALL keep the store chosen.

#### Scenario: A Cluster Manager moves between reports

- **WHEN** a Cluster Manager chooses Hillview on the sales report, then opens the vendor report and comes back
- **THEN** the vendor report shows no store choice, and the sales report opens on Hillview again

### Requirement: A Dive is sent only filters, never wider than the reader's reach
Dash SHALL send a Dive only the filters its report row names, filled from the reader's reach. When a report's shape can't express a reader's reach, Dash SHALL refuse to open it rather than send a wider filter.

#### Scenario: A whole-stores report for a section reader

- **WHEN** a Team Leader opens the whole-stores report from its address
- **THEN** the page says the report covers whole stores, so it isn't available for their job, and nothing is sent to the Dive

### Requirement: Reach follows the person's current job
A reader's reach SHALL come from their current job assignments: their section's subcategories for Staff and Team Leaders, their floor's sections for Floor Managers, the whole store for Store Managers, the stores of their cluster for Cluster Managers, and every store for directors. Head office staff SHALL reach nothing, unless they hold the Dash All-Stores Reader role.

#### Scenario: A Floor Manager

- **WHEN** a Floor Manager of Lakeside's first floor opens the sales report
- **THEN** they see the subcategories of that floor's sections at Lakeside, and nothing else

### Requirement: A reader who reaches nothing is told why
A reader whose job reaches nothing SHALL see why, in plain words: no section set against them, with a way to Your sections, or departments not yet filled in. Someone with no report at all SHALL be told they have none yet.

#### Scenario: Staff with no section

- **WHEN** a member of staff with no section opens Dash
- **THEN** they are told they aren't set against a section yet, with a way to open Your sections

### Requirement: A report taking no filter opens for someone given it
A report that takes no filter SHALL open for someone given it even when their job reaches no store. A report filtered by store SHALL stay closed to them.

#### Scenario: Head office staff

- **WHEN** a head office person opens a report taking no filter, then the sales report
- **THEN** the first opens and the second is refused

### Requirement: A report that can't open says so
A report whose Dive can't open SHALL show its quick view when it has one, and otherwise say the report couldn't open, with a way to try again. A report the reader can't open, or that doesn't exist, SHALL say they can't open it.

#### Scenario: An unknown report

- **WHEN** a reader with reports opens an address naming a report that doesn't exist
- **THEN** they are told they can't open this report, and their own reports stay listed

### Requirement: Staff screens name stores, never codes
Dash SHALL name a store by its name and a subcategory by its name on every staff screen, never by a plant, short or subcategory code.

#### Scenario: A Store Manager's heading

- **WHEN** the Store Manager of Lakeside opens the sales report
- **THEN** the heading says Lakeside, never its code

### Requirement: A role can reach every store
A person holding the Dash All-Stores Reader role SHALL reach every store, as a director's job does, in addition to whatever their jobs reach, and each store SHALL say "You see every store because you hold Dash All-Stores Reader". Holding the role alone SHALL open Dash. Once they reach stores, Dash SHALL NOT tell them their job is in head office or that they are not on the staff list.

#### Scenario: A head-office person given the role

- **WHEN** a head office person holding Dash All-Stores Reader opens the sales report
- **THEN** it opens with every store, and nothing says their job is in head office
