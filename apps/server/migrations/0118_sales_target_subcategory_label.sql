-- 24-Oct-2026: on every surface a person reads, a material group is called a "subcategory";
-- material_group stays as the column name (the SAP code, MATKL). The Sales Target Assignment
-- Table was created before its column definition carried a label, so the Desk shows the raw
-- name. Only a label still at its default changes: a label someone set by hand is kept.
update featherbase.column_def
   set label = 'Subcategory'
 where parent = 'Sales Target Assignment'
   and column_name = 'material_group'
   and (label is null or label = 'material_group');
