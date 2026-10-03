# Sales Target Report Delta

## ADDED Requirements

### Requirement: A Store Manager sees the whole store

When the store's Store Manager row names a reader's employee code, the report
SHALL show that reader every material group the store's merchandise map holds,
grouped by Section with a subtotal per Section, and SHALL say they see it as
Store Manager. A Store Manager's scope SHALL stop at their own store. An
instance without the Store Manager Table SHALL behave as before.

#### Scenario: The ATK Store Manager opens the report

- **WHEN** the Store Manager of Attakulangara signs in and opens the report
- **THEN** they see every Section of Attakulangara, each with its subtotal, and the reason "Store Manager"

#### Scenario: Another store's manager

- **WHEN** the Store Manager of Kattakada opens the report
- **THEN** they see Kattakada's material groups only

#### Scenario: No Store Manager Table

- **WHEN** the instance has no Store Manager Table
- **THEN** nobody is given a store-wide scope by it

### Requirement: Many Sections are counted, not listed

The report's heading SHALL name a reader's Sections when there are three or
fewer. With more than three it SHALL show their number instead — "Whole store ·
N Sections" for a Store Manager, "N Sections" for anyone else — and the full
list SHALL be reachable by a tap or a key press, not only by hovering.

#### Scenario: A Team Leader with one Section

- **WHEN** a Team Leader whose scope is one Section opens the report
- **THEN** the heading names that Section and offers nothing to expand

#### Scenario: A Store Manager with 57 Sections

- **WHEN** the Store Manager of Attakulangara opens the report
- **THEN** the heading reads "Whole store · 57 Sections", and tapping it lists all 57

#### Scenario: A Department Manager with five Sections

- **WHEN** a Department Manager whose scope is five Sections opens the report
- **THEN** the heading reads "5 Sections", and tapping it lists them
