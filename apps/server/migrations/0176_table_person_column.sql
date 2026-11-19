-- #1345: a Table can say its rows are a person's record, through one of its
-- Reference columns to Person (an Employee row, through `person`). Search
-- folds such a row into its Person, so one human is listed once.
alter table featherbase.table_def add column if not exists person_column text;
