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
A report whose Dive can't open SHALL say the report couldn't open, with a way to try again. A report the reader can't open, or that doesn't exist, SHALL say they can't open it.

#### Scenario: An unknown report

- **WHEN** a reader with reports opens an address naming a report that doesn't exist
- **THEN** they are told they can't open this report, and their own reports stay listed

#### Scenario: The Dive can't be reached

- **WHEN** a Team Leader opens the sales report and MotherDuck refuses its Dive
- **THEN** the page says the report couldn't open and offers to try again, and shows no figures of its own

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

### Requirement: Whoever gives reports can add a Dive as one
A person who manages report access SHALL be able to add any Dive in the organisation's MotherDuck as a report, by searching for it or pasting its link, and give it at once. An added report SHALL take no filter, so everyone given it sees everything the Dive shows. Dash SHALL refuse a Dive that is already a report, naming that report, and a name another report already has. Nobody else SHALL be able to list or add Dives.

#### Scenario: A buyer brings in a Dive he built

- **WHEN** a Report Access Manager pastes the link of a Dive he saved today, names it "Floor stock" and adds it
- **THEN** "Floor stock" can be given or put in a bundle straight away, and someone given it opens the Dive

#### Scenario: A Dive already in Dash

- **WHEN** a Report Access Manager finds the Women Buyers Dashboard, which is already a report
- **THEN** it says which report opens it, and it can't be added again

### Requirement: A reader reports an issue from the report
Every report SHALL offer "Report an issue" wherever Tickets runs on the instance. The reader SHALL choose what is wrong from Data looks wrong, Stock missing, Item ran out, Target too high or too low, or Something else, and MAY name the item, store or number and add a note. The ticket SHALL carry, untyped, the report, a link back to the view, the store and month on show, the Dive's filters, the reader's reach and job, and the time.

#### Scenario: A Team Leader says a target is too high

- **GIVEN** a Team Leader of Sarees and Kids Wear at Lakeside opens Sales versus target
- **WHEN** they choose "Target too high or too low", name "Kanchipuram silk target" and send
- **THEN** a ticket "Target too high or too low: Sales versus target" is raised as theirs
- **AND** it carries the report, a link back to the view, Lakeside, this month, their sections and job, and the time
- **AND** the panel links to the ticket and lists it among their open feedback on this report

### Requirement: The reader's own ticket, and only one
The ticket SHALL be raised in Tickets by the reader themselves, and a retried Send SHALL never raise a second ticket. Once sent, the reader SHALL see a link to their ticket and their open feedback on that report.

#### Scenario: A lost answer is retried

- **GIVEN** a reader's Send reached Tickets but its answer was lost
- **WHEN** they press Send again without changing anything
- **THEN** Tickets answers with the same ticket and raises no second one

### Requirement: Every report opened is recorded
Each time a reader opens a report, Dash SHALL record it once in the Access Log, whichever report it is, so that who looked at reports, and when, can be answered. A report that is refused, or whose Dive can't open, SHALL NOT be recorded as opened.

#### Scenario: A Team Leader opens two reports

- **WHEN** a Team Leader opens the sales report, then the vendor report
- **THEN** the Access Log shows two openings by them

#### Scenario: A whole-stores report refused

- **WHEN** the same Team Leader opens the whole-stores report from its address
- **THEN** nothing is added to the Access Log
