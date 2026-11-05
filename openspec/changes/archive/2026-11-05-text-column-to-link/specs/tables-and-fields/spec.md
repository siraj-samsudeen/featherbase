## MODIFIED Requirements

### Requirement: A column's type is fixed once created

Changing an existing column's type SHALL be refused, naming the column; the
column keeps its type and its values. There are two exceptions, and in both the
column keeps its name and every value. A text column SHALL become a link to a
table when every non-empty value in it is the id of a row of that table; if any
value isn't, the change SHALL be refused, listing those values. A link column
SHALL always be able to become a text column.

#### Scenario: Turn a text column into a number

- **WHEN** a builder tries to change a text column to a number column
- **THEN** the change is refused and the column is named

#### Scenario: Turn plant codes into links

- **WHEN** a builder turns a plant's "sales org" text column, holding "1150"
  and "1160", into a link to Sales Org, which has rows "1150" and "1160"
- **THEN** the column is a link to Sales Org and every plant keeps its value
- **AND** the column's history still shows the earlier changes to it

#### Scenario: A code with no master row

- **WHEN** a builder turns the "sales org" column into a link to Sales Org,
  and one plant holds "9999", which Sales Org doesn't have
- **THEN** the change is refused, naming "9999"
- **AND** the column stays text with every value as it was

#### Scenario: Turn a link back into text

- **WHEN** a builder turns the "sales org" link column back into text
- **THEN** the column is text and every plant keeps its value
