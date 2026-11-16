# Actor Names

## Purpose
Wherever Featherbase or an app shows who did something — gave a role, set a limit, shared a row,
wrote a comment or a version — the reader sees a name they understand: a person's display name, a
service account as automation, a system step as a phrase. Who acted is not hidden from the people
who see it done; nothing else about them travels with the name.

## Requirements

### Requirement: Who did something is named to those who see it done

Where the platform shows who gave a role, set a limit, shared a row, or wrote a comment or a
version of a row the viewer may see, it SHALL name that person by their display name even when the
viewer may not read Person. It SHALL NOT show their address or opaque id. A system step SHALL read
as a phrase ("Staff roster sync", "Google sign-in").

#### Scenario: A role given by someone the viewer may not read

- **WHEN** a System Manager named "Made-up Director" gives a person a role, and that person may not read Person
- **THEN** the person's "What you can see" page reads "given by Made-up Director"
- **AND** never "Unnamed person"

### Requirement: An app names only the actors of its own data

An app SHALL be able to ask for the names of the people who acted on its own data: who created or
last changed one of its rows, or made, changed or decided one of its change proposals. Any other id
SHALL come back unnamed.

#### Scenario: An unrelated id is not named

- **WHEN** an app asks for the names of a person who wrote one of its rows and of a person who never touched its data
- **THEN** the first is named and the second is not
