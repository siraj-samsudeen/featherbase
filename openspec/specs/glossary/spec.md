# glossary Specification

## Purpose
Every app brings words its users must learn. The glossary keeps those words
and what they mean in one place that everyone signed in can read, and offers
a word's meaning where it appears. Apps ship their terms; an instance adds its
own and may reword an app's without losing that wording when the app is
upgraded.

## Requirements

### Requirement: Apps ship their terms

An app SHALL be able to bring its own glossary terms. A term is a word the
app's users must learn, with a short definition and, where they help,
examples, words to avoid and the Tables or columns it describes. Installing
the app SHALL add its terms to the glossary, under the app's name.

#### Scenario: Installing an app adds its terms

- **WHEN** a System Manager installs a shelf-planning app that defines
  "Shelf Lead" and "Coverage"
- **THEN** both terms appear in the glossary under that app, with their
  definitions, examples and words to avoid

### Requirement: Everyone can read the glossary

Everyone signed in SHALL be able to read the glossary, grouped by app, and
search it. A search SHALL match a term's name, its words to avoid and its
definition.

#### Scenario: Searching by a word to avoid

- **WHEN** the user searches for "scope", a word the "Coverage" term says to
  avoid
- **THEN** the "Coverage" term is found

### Requirement: Help where the word appears

A Table or column that a term describes SHALL offer that term's meaning where
its name appears, without leaving the page. A Table or column no term
describes SHALL offer nothing.

#### Scenario: A column's meaning in place

- **WHEN** the user opens a shelf assignment and asks what its job field
  means
- **THEN** the "Shelf Lead" term opens beside the field, and the fields no
  term describes offer no help

### Requirement: Instances add and reword terms

People allowed to edit the glossary SHALL be able to add the instance's own
terms and reword an app's terms. System Managers SHALL always be allowed, and
an instance MAY allow other roles. Everyone else SHALL only read.

#### Scenario: An instance's own term

- **WHEN** a System Manager adds a term that belongs to no app
- **THEN** it appears in the glossary under the instance's own group

#### Scenario: Reading only

- **WHEN** a person without permission to edit the glossary tries to change a
  term
- **THEN** the change is refused

### Requirement: Local wording survives upgrades

An app upgrade SHALL refresh the app's terms the instance has not reworded,
and SHALL never overwrite one it has. When the app's own wording of a
reworded term changes, the glossary SHALL say so, and an editor SHALL be able
to take the app's wording instead.

#### Scenario: An upgrade with new wording

- **WHEN** the instance has reworded "Coverage" and the app is upgraded with
  a new wording of its own
- **THEN** the instance's wording stays, the term shows that the app's
  wording changed, and taking the app's wording replaces the local one

### Requirement: Terms follow their app

The terms of an app that is removed or turned off SHALL leave the glossary,
and SHALL return, with any local rewording, when the app comes back.

#### Scenario: Reinstalling brings local wording back

- **WHEN** an app whose term the instance reworded is removed and later
  installed again
- **THEN** the term returns with the instance's wording

### Requirement: Terms describe only the app's own Tables

An app SHALL be refused when one of its terms describes a Table or column the
app does not own or declare, and the refusal SHALL name the term.

#### Scenario: A term pointing elsewhere

- **WHEN** an app's term describes another app's Table
- **THEN** the app is refused, and the reason names that term
