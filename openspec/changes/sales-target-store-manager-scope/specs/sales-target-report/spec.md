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
