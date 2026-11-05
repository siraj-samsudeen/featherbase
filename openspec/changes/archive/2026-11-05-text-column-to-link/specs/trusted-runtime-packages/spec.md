## MODIFIED Requirements

### Requirement: A change of kind keeps every value

An upgrade SHALL change a column's kind only where every stored value carries
over, such as whole numbers to decimals or a date to a date and time. A text
column SHALL become a link to a table only when every value on the instance
names a row of that table, and a link SHALL always become text. Any other
change of kind SHALL be refused: the app adds a new column, copies the data and
then removes the old one.

#### Scenario: Whole numbers become decimals

- **WHEN** an upgrade changes a quantity column from whole numbers to decimals
- **THEN** every quantity keeps its value

#### Scenario: A change that would lose values is refused

- **WHEN** a new version changes a number column into a date column
- **THEN** that version is refused before anything runs

#### Scenario: Codes become links when every code has a row

- **WHEN** an upgrade turns a plant's state code column into a link to State,
  and one plant holds a code State doesn't have
- **THEN** the upgrade is refused on that instance, naming the code, and
  nothing changes
