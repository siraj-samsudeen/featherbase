## ADDED Requirements

### Requirement: A copy refuses whole numbers it cannot hold exactly

A copy or Copy again SHALL refuse the whole run when a whole-number column meets a value beyond ±9,007,199,254,740,991. The refusal SHALL name the column, the value and the row, and no row SHALL change. Values inside that range SHALL copy as numbers.

#### Scenario: A BIGINT past the exact range

- **WHEN** a System Manager copies a warehouse table whose BIGINT column holds 9007199254740993 in one row
- **THEN** the copy is refused with a message naming that column, the value and the row, and no Table is created

#### Scenario: Copy again meets one later

- **WHEN** a copied table's source later holds such a value and Copy again runs
- **THEN** Copy again is refused the same way and the copied rows are unchanged

### Requirement: The deleted-at-source marker keeps its name while the Table is copied

While a Table is copied from a data source, the system SHALL refuse to rename or remove its deleted-at-source marker column, so Copy again keeps working.

#### Scenario: Renaming or removing the marker

- **WHEN** a System Manager renames or removes the deleted-at-source column of a copied Table
- **THEN** the change is refused with a message that the column marks rows deleted at the source, and Copy again still works
