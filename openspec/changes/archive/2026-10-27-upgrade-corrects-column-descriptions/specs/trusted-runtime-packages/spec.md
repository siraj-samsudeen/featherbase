## MODIFIED Requirements

### Requirement: An upgrade can reshape the app's own tables

A new version of an app SHALL be able to add and remove its tables, add a
column of any kind, change a column's label, description (the line a form
shows under it), choices, default, whether it is required, unique or hidden,
rename a column or a table, and remove a column. Changing a label or a
description SHALL change only what people read. A rename SHALL keep the rows,
their history, the links to them and who may see them. An upgrade SHALL change
only the app's own tables, never Featherbase's or the instance's.

#### Scenario: A renamed table keeps its rows and history

- **WHEN** an app's new version renames its Note table to Memo, and two notes
  with a comment on one of them exist
- **THEN** after the upgrade both rows are in Memo
- **AND** the comment still belongs to its row

#### Scenario: A table that decides people's scope stays guarded

- **WHEN** an app renames a table whose rows decide which places people cover
- **THEN** the renamed table still decides scope
- **AND** only a System Manager can still change its rows

#### Scenario: A corrected description reaches every form

- **WHEN** an app's new version corrects a column's description from
  "material group" to "subcategory"
- **THEN** the upgrade's preview says it removes nothing
- **AND** after the upgrade the form shows "subcategory" under that column
