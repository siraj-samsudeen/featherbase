## ADDED Requirements

### Requirement: An address nothing answers says so

An address the server cannot open as an app SHALL lead to the shared page that
says nothing is available there, under the top bar, in the person's theme. The
address is repeated as text only. That an app is turned off is said only to
someone who could use it; signed out, or without access, nothing tells whether
an app exists. The page offers one way forward (#1328).

#### Scenario: A mistyped address

- **WHEN** an administrator opens `/equipment/`
- **THEN** the page reads "Nothing is available at /equipment/" with "Go to Featherbase"

#### Scenario: An app that is turned off

- **WHEN** an administrator opens a turned-off app's address
- **THEN** the page reads "<App> is turned off" and asks them to ask their system manager

#### Scenario: Signed out

- **WHEN** someone signed out opens a turned-off app's address
- **THEN** the page reads "Nothing is available at" that address, with no top bar, exactly as for an address no app has
