-- #1273: a Table whose rows come from a feed can name where a wrong row is
-- corrected: an address inside the instance, with {column} for a row's value.
-- The record's tick list offers Correct beside a locked feed row only then.
alter table featherbase.table_def add column if not exists correction_path text;
