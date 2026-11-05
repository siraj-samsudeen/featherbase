# Running an Instance


## ADDED Requirements

### Requirement: A deploy waits out long work by itself

A deploy SHALL keep trying to start for about ten minutes while the live server is busy, and SHALL say what it is doing at each try. Between tries, the live server SHALL be left free to answer people. If it still cannot start, the deploy SHALL fail with nothing changed.

#### Scenario: A long copy is running when the deploy starts

- **WHEN** the user deploys while a long copy is being applied
- **THEN** the deploy reports each try, and starts once the copy has finished

#### Scenario: The server stays busy for the whole wait

- **WHEN** the live server is still busy after about ten minutes
- **THEN** the deploy fails, says nothing changed, and the old version keeps serving
