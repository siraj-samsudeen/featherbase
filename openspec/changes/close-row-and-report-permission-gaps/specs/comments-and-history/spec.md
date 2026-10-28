## ADDED Requirements

### Requirement: Only someone who can open the row removes its comments

A comment SHALL be removed or edited only by someone who can open the row it
is on, whatever their access to comments in general.

#### Scenario: Removing a comment on a row the user cannot open

- **WHEN** a user who may remove comments names a comment on a row they
  cannot open
- **THEN** it is refused and the comment is kept
