# Dash Reports

## RENAMED Requirements

- FROM: `### Requirement: A role can reach every store`
- TO: `### Requirement: A role can reach every store of the holder's region`

## MODIFIED Requirements

### Requirement: Reach follows the person's current job
A reader's reach SHALL come from their current job assignments: their section's subcategories for Staff and Team Leaders, their floor's sections for Floor Managers, the whole store for Store Managers, the stores of their cluster for Cluster Managers, and for a Director, Managing Director or Chief Operating Officer the open stores whose site is in the operating region of the job's site, a head office's included. Head office staff SHALL reach nothing, unless they hold the Dash All-Stores Reader role.

#### Scenario: A Floor Manager

- **WHEN** a Floor Manager of Lakeside's first floor opens the sales report
- **THEN** they see the subcategories of that floor's sections at Lakeside, and nothing else

#### Scenario: A director at a head office

- **WHEN** a Director whose job is at the North head office opens the sales report
- **THEN** they see every open store in the North, and none in the South


### Requirement: A role can reach every store of the holder's region
A person holding the Dash All-Stores Reader role SHALL reach every open store whose site is in the operating region of one of their job sites, as a director's job does, in addition to whatever their jobs reach, and each such store SHALL say "You see every store in your region because you hold Dash All-Stores Reader". With no job site the role SHALL reach nothing. Holding the role alone SHALL open Dash. Once they reach stores, Dash SHALL NOT tell them their job is in head office or that they are not on the staff list.

#### Scenario: A head-office person given the role

- **WHEN** a head office person in the North holding Dash All-Stores Reader opens the sales report
- **THEN** it opens with every store in the North and none in the South, and nothing says their job is in head office
