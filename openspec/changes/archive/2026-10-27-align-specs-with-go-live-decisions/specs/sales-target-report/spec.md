## MODIFIED Requirements

### Requirement: The live report fails honestly

When the live report session cannot be started because the instance has no live report set up, the page SHALL quietly show the cached table as the report, with no error. When it is set up but unreachable or refuses, the page SHALL say in one plain sentence that the report couldn't load and offer to try again, without technical detail. The live report's credentials SHALL never be sent to the browser.

#### Scenario: No live report on this instance

- **WHEN** the instance has no live report set up
- **THEN** the cached table is the report, shown open, with no error

#### Scenario: The live report service is down

- **WHEN** the live report service cannot be reached
- **THEN** the page says the report couldn't load right now, and trying again reopens the report without reloading the page
