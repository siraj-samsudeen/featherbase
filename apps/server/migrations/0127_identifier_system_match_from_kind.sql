-- #532 (person-resolution D2, "kind drives every other default"): the match
-- column of Identifier System was created with a default of 'Off'. Column
-- defaults are filled before the controller applies the kind's preset, so a
-- system saved without Match was stored Off even when its kind's preset is
-- Suggest. The kind is the only default: the column carries none. Rows
-- already stored keep their value; an explicit Off cannot be told apart.
update featherbase.column_def
   set default_value = null
 where parent = 'Identifier System'
   and column_name = 'match'
   and default_value = 'Off';
