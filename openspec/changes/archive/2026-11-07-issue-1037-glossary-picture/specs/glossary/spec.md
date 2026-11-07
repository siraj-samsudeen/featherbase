## ADDED Requirements

### Requirement: A term carries a picture

A glossary term MAY carry a picture, such as a diagram of how words relate.
The glossary SHALL show the picture with the term's definition, and everyone
who can read the glossary SHALL be able to open it. A picture SHALL NOT count
as rewording an app's term, and an app upgrade SHALL keep it.

#### Scenario: A diagram on a term

- **WHEN** a System Manager adds a diagram to the "Site" term
- **THEN** everyone who reads the glossary sees the diagram under the
  definition of "Site", and can open it full size

#### Scenario: An upgrade keeps the picture

- **WHEN** an app's term has a picture added here and the app is upgraded
- **THEN** the term still has its picture, and is not marked as edited here
