# Actor Names

## MODIFIED Requirements

### Requirement: Who did something is named to those who see it done

Where the platform shows who gave a role, set a limit, shared a row, wrote a comment or a
version, made, last changed or retired a row, or archived a Table — on a row or Table the viewer
may read — it SHALL name that person by their display name even when the viewer may not read
Person. It SHALL NOT show their address or opaque id, and it SHALL NOT name an id that did none of
these on something the viewer may read. A system step SHALL read as a phrase ("Staff roster sync",
"Google sign-in").

#### Scenario: A role given by someone the viewer may not read

- **WHEN** a System Manager named "Made-up Director" gives a person a role, and that person may not read Person
- **THEN** the person's "What you can see" page reads "given by Made-up Director"
- **AND** never "Unnamed person"

#### Scenario: Who made a row the viewer may read

- **WHEN** a reader who may not read Person opens a list whose rows someone else made
- **THEN** the "Created by" column names that person
- **AND** a person who never acted on rows the reader may read stays unnamed
