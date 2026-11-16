## ADDED Requirements

### Requirement: Whoever gives reports can add a Dive as one
A person who manages report access SHALL be able to add any Dive in the organisation's MotherDuck as a report, by searching for it or pasting its link, and give it at once. An added report SHALL take no filter, so everyone given it sees everything the Dive shows. Dash SHALL refuse a Dive that is already a report, naming that report, and a name another report already has. Nobody else SHALL be able to list or add Dives.

#### Scenario: A buyer brings in a Dive he built

- **WHEN** a Report Access Manager pastes the link of a Dive he saved today, names it "Floor stock" and adds it
- **THEN** "Floor stock" can be given or put in a bundle straight away, and someone given it opens the Dive

#### Scenario: A Dive already in Dash

- **WHEN** a Report Access Manager finds the Women Buyers Dashboard, which is already a report
- **THEN** it says which report opens it, and it can't be added again
