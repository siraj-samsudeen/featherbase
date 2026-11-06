## ADDED Requirements

### Requirement: A Table's title column is chosen on its Columns page

The Columns page SHALL offer one Title choice per column that can name a row, save the choice at once, and let it be cleared. It SHALL take effect straight away in the Table's list, its row headings and every link to its rows.

#### Scenario: Choosing a title

- **WHEN** a System Manager chooses the "Zone name" column as the title
- **THEN** the page says so, and a link to a row of that Table reads the row's zone name

#### Scenario: Columns that can't be a title

- **WHEN** a column is hidden, or holds a date, a tick or another type that can't name a row
- **THEN** it has no Title choice
