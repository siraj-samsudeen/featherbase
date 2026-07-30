-- Round 1 of the terminology rename (#59/#61): DocType -> Table, Doc -> Row,
-- Field -> Column, plus the other vocabulary decisions (docstatus -> status,
-- idx -> position, owner -> created_by, modified(_by) -> updated_(at/by),
-- creation -> created_at, permlevel -> tier, istable/issingle -> kind,
-- autoname -> id_pattern, if_owner -> own_rows_only, tab_ prefix dropped,
-- DocPerm/DocShare/User Permission -> Permission/Share/Data Scope).
--
-- Every step is existence-checked so this is safe whether the database is at
-- the original 0001-0054 state, already partially renamed, or (on a brand
-- new install where 0005+ have already been rewritten to call the new
-- engine directly) mostly a no-op.

-- ============================================================
-- 1. Bootstrap metadata tables: doctype/docfield -> table_def/column_def
-- ============================================================
do $$
begin
  if to_regclass('tab_doctype') is not null then
    execute 'alter table tab_doctype rename to table_def';
  end if;
  if to_regclass('tab_docfield') is not null then
    execute 'alter table tab_docfield rename to column_def';
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_name='table_def' and column_name='issingle') then
    alter table table_def add column if not exists kind text;
    update table_def set kind = case when issingle then 'settings' when istable then 'sub_table' else 'table' end;
    alter table table_def alter column kind set not null, alter column kind set default 'table';
    alter table table_def drop column issingle, drop column istable;
  end if;
  if exists (select 1 from information_schema.columns where table_name='table_def' and column_name='autoname') then
    alter table table_def rename column autoname to id_pattern;
  end if;
  if exists (select 1 from information_schema.columns where table_name='table_def' and column_name='title_field') then
    alter table table_def rename column title_field to title_column;
  end if;
  if exists (select 1 from information_schema.columns where table_name='table_def' and column_name='sort_field') then
    alter table table_def rename column sort_field to sort_column;
    update table_def set sort_column = 'updated_at' where sort_column = 'modified';
  end if;
  if exists (select 1 from information_schema.columns where table_name='table_def' and column_name='owner') then
    alter table table_def rename column owner to created_by;
  end if;
  if exists (select 1 from information_schema.columns where table_name='table_def' and column_name='modified_by') then
    alter table table_def rename column modified_by to updated_by;
  end if;
  if exists (select 1 from information_schema.columns where table_name='table_def' and column_name='creation') then
    alter table table_def rename column creation to created_at;
  end if;
  if exists (select 1 from information_schema.columns where table_name='table_def' and column_name='modified') then
    alter table table_def rename column modified to updated_at;
  end if;
  if exists (select 1 from information_schema.columns where table_name='table_def' and column_name='docstatus') then
    alter table table_def add column if not exists status text;
    update table_def set status = case docstatus when 0 then 'draft' when 1 then 'submitted' when 2 then 'cancelled' else 'draft' end;
    alter table table_def alter column status set default 'draft', alter column status set not null;
    alter table table_def drop column docstatus;
  end if;
  if exists (select 1 from information_schema.columns where table_name='table_def' and column_name='idx') then
    alter table table_def rename column idx to position;
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='fieldname') then
    alter table column_def rename column fieldname to column_name;
  end if;
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='fieldtype') then
    alter table column_def rename column fieldtype to column_type;
    update column_def set column_type = 'Reference' where column_type = 'Link';
    update column_def set column_type = 'Choice' where column_type = 'Select';
    update column_def set column_type = 'Sub-table' where column_type = 'Table';
  end if;
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='options') then
    alter table column_def add column if not exists reference_table text;
    alter table column_def add column if not exists choices text;
    alter table column_def add column if not exists row_table text;
    update column_def set reference_table = options where column_type = 'Reference';
    update column_def set choices = options where column_type = 'Choice';
    update column_def set row_table = options where column_type = 'Sub-table';
    alter table column_def drop column options;
  end if;
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='idx') then
    alter table column_def rename column idx to position;
  end if;
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='permlevel') then
    alter table column_def add column if not exists tier text;
    update column_def set tier = case when permlevel > 0 then 'restricted' else 'basic' end;
    alter table column_def alter column tier set not null, alter column tier set default 'basic';
    alter table column_def drop column permlevel;
  end if;
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='owner') then
    alter table column_def rename column owner to created_by;
  end if;
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='modified_by') then
    alter table column_def rename column modified_by to updated_by;
  end if;
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='creation') then
    alter table column_def rename column creation to created_at;
  end if;
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='modified') then
    alter table column_def rename column modified to updated_at;
  end if;
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='docstatus') then
    alter table column_def add column if not exists status text;
    update column_def set status = case docstatus when 0 then 'draft' when 1 then 'submitted' when 2 then 'cancelled' else 'draft' end;
    alter table column_def alter column status set default 'draft', alter column status set not null;
    alter table column_def drop column docstatus;
  end if;
end $$;

-- ============================================================
-- 2. The four renamed system entities (as data, and as the tables backing
--    them, which today are just dynamically created "tab_<name>" tables).
-- ============================================================
do $$
begin
  if to_regclass('tab_docperm') is not null then execute 'alter table tab_docperm rename to permission'; end if;
  if to_regclass('docperm') is not null then execute 'alter table docperm rename to permission'; end if;
  if to_regclass('tab_docshare') is not null then execute 'alter table tab_docshare rename to share'; end if;
  if to_regclass('docshare') is not null then execute 'alter table docshare rename to share'; end if;
  if to_regclass('tab_user_permission') is not null then execute 'alter table tab_user_permission rename to data_scope'; end if;
  if to_regclass('user_permission') is not null then execute 'alter table user_permission rename to data_scope'; end if;
end $$;

-- table_def.name is referenced by column_def.parent via a non-deferrable
-- foreign key, so renaming both sides in the same transaction trips it no
-- matter which order the two UPDATEs run in. Drop it for the renames below
-- (both here and the Property Setter one further down) and recreate it once
-- both sides are consistent.
--
-- The FK's NAME depends on the era the database was bootstrapped in —
-- constraint names survive table renames, so a database that began life
-- with `docfield` carries `docfield_parent_fkey` all the way through the
-- tab_docfield and column_def renames, while a fresh install's 0002 names
-- it `column_def_parent_fkey`. Drop by lookup, never by assumed name
-- (a wrong name here is a silent `if exists` no-op and the UPDATE below
-- then trips the still-armed FK — the exact upgrade bug this block fixes).
do $$
declare fk text;
begin
  for fk in
    select conname from pg_constraint
    where contype = 'f' and conrelid = 'column_def'::regclass
  loop
    execute format('alter table column_def drop constraint %I', fk);
  end loop;
end $$;

update column_def set parent = 'Table' where parent = 'DocType';
update column_def set parent = 'Column' where parent = 'DocField';
update column_def set parent = 'Permission' where parent = 'DocPerm';
update column_def set parent = 'Share' where parent = 'DocShare';
update column_def set parent = 'Data Scope' where parent = 'User Permission';

update table_def set name = 'Table' where name = 'DocType';
update table_def set name = 'Column' where name = 'DocField';
update table_def set name = 'Permission' where name = 'DocPerm';
update table_def set name = 'Share' where name = 'DocShare';
update table_def set name = 'Data Scope' where name = 'User Permission';

update column_def set reference_table = 'Table' where reference_table = 'DocType';
update column_def set reference_table = 'Column' where reference_table = 'DocField';
update column_def set reference_table = 'Permission' where reference_table = 'DocPerm';
update column_def set reference_table = 'Share' where reference_table = 'DocShare';
update column_def set reference_table = 'Data Scope' where reference_table = 'User Permission';
update column_def set row_table = 'Column' where row_table = 'DocField';

do $$
begin
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='parenttype') then
    update column_def set parenttype = 'Table' where parenttype = 'DocType';
    alter table column_def alter column parenttype set default 'Table';
  end if;
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='parentfield') then
    update column_def set parentfield = 'columns' where parentfield = 'fields';
    alter table column_def alter column parentfield set default 'columns';
  end if;
  if exists (select 1 from information_schema.columns where table_name='column_def' and column_name='column_name') then
    update column_def set column_name = 'columns', row_table = 'Column'
      where parent = 'Table' and column_name = 'fields';
    update column_def set choices = replace(replace(replace(choices,
      E'Link', E'Reference'), E'Select', E'Choice'), E'\nTable\n', E'\nSub-table\n')
      where parent = 'Column' and column_name = 'column_type';
    update column_def set column_name = 'ref_table' where parent = 'Permission' and column_name = 'ref_doctype';
    update column_def set reference_table = 'Table' where parent = 'Permission' and column_name = 'ref_table';
    update column_def set column_name = 'own_rows_only' where parent = 'Permission' and column_name = 'if_owner';
    update column_def set column_name = 'share_table' where parent = 'Share' and column_name = 'share_doctype';
    update column_def set reference_table = 'Table' where parent = 'Share' and column_name = 'share_table';
    update column_def set column_name = 'allow_table' where parent = 'Data Scope' and column_name = 'allow';
    update column_def set reference_table = 'Table' where parent = 'Data Scope' and column_name = 'allow_table';
  end if;
end $$;

-- Any Table anywhere (not just the four above) whose columns reference these
-- renamed entities by name — e.g. Comment/Version/File's `ref_doctype`.
update column_def set column_name = 'ref_table' where column_name = 'ref_doctype';
update column_def set reference_table = 'Table' where reference_table = 'DocType';

-- ============================================================
-- 2b. METADATA parity for every engine Table whose columns the rewritten
--     0002-0054 now seed under new names on fresh installs. Verified by
--     diffing column_def between an upgraded and a fresh database — each
--     UPDATE below closes one row of that diff. Type-specific values
--     (choices, defaults) are set explicitly to the fresh seeds' values.
--     NOTE: the Table `kind` and `tier` choices intentionally contain a
--     LITERAL backslash-n (matching what the fresh .ts seeds store); the
--     E'' strings are real newlines.
-- ============================================================

-- Table's own definition: autoname/title_field/issingle/istable -> new shape.
update column_def set column_name = 'id_pattern', label = 'ID Pattern'
  where parent = 'Table' and column_name = 'autoname';
update column_def set column_name = 'title_column', label = 'Title Column'
  where parent = 'Table' and column_name = 'title_field';
update column_def set column_name = 'kind', label = 'Kind', column_type = 'Choice',
    choices = 'table\nsub_table\nsettings'
  where parent = 'Table' and column_name = 'issingle';
delete from column_def where parent = 'Table' and column_name = 'istable';

-- Column's own definition: fieldname/fieldtype/options/permlevel.
update column_def set column_name = 'column_name', label = 'Column Name'
  where parent = 'Column' and column_name = 'fieldname';
update column_def set column_name = 'column_type', label = 'Column Type',
    choices = E'Data\nInt\nFloat\nCurrency\nCheck\nChoice\nDate\nDatetime\nText\nLong Text\nReference\nSub-table\nAttach\nAttach Image\nJSON\nSection Break\nColumn Break'
  where parent = 'Column' and column_name = 'fieldtype';
update column_def set column_name = 'choices', label = 'Choices', position = 5
  where parent = 'Column' and column_name = 'options';
insert into column_def (parent, column_name, label, column_type, position)
  select 'Column', 'reference_table', 'Reference Table', 'Data', 4
  where not exists (select 1 from column_def where parent = 'Column' and column_name = 'reference_table');
insert into column_def (parent, column_name, label, column_type, position)
  select 'Column', 'row_table', 'Row Table', 'Data', 6
  where not exists (select 1 from column_def where parent = 'Column' and column_name = 'row_table');
update column_def set column_name = 'tier', label = 'Tier', column_type = 'Choice',
    choices = 'basic\nrestricted'
  where parent = 'Column' and column_name = 'permlevel';

-- Custom Field mirrors Column's shape.
update column_def set column_name = 'column_name', label = 'column_name'
  where parent = 'Custom Field' and column_name = 'fieldname';
update column_def set column_name = 'column_type', label = 'column_type', default_value = 'Data'
  where parent = 'Custom Field' and column_name = 'fieldtype';
update column_def set column_name = 'choices', label = 'choices', position = 6
  where parent = 'Custom Field' and column_name = 'options';
insert into column_def (parent, column_name, label, column_type, position)
  select 'Custom Field', 'reference_table', 'reference_table', 'Data', 5
  where not exists (select 1 from column_def where parent = 'Custom Field' and column_name = 'reference_table');
insert into column_def (parent, column_name, label, column_type, position)
  select 'Custom Field', 'row_table', 'row_table', 'Data', 7
  where not exists (select 1 from column_def where parent = 'Custom Field' and column_name = 'row_table');

-- Permission's permlevel -> tier (its ref_doctype -> ref_table is above).
update column_def set column_name = 'tier', label = 'Tier', column_type = 'Choice',
    choices = 'basic\nrestricted'
  where parent = 'Permission' and column_name = 'permlevel';

-- Domain `status` columns that collided with the new standard row-lifecycle
-- `status` and were renamed per-Table.
update column_def set column_name = 'send_status', label = 'send_status',
    choices = E'queued\nsent\nerror', default_value = 'queued'
  where parent = 'Email Queue' and column_name = 'status';
update column_def set column_name = 'ticket_status', label = 'Status',
    choices = E'Open\nIn Progress\nResolved\nClosed', default_value = 'Open'
  where parent = 'HD Ticket' and column_name = 'status';
update column_def set column_name = 'todo_status', label = 'todo_status',
    choices = E'Open\nClosed', default_value = 'Open'
  where parent = 'ToDo' and column_name = 'status';
update column_def set column_name = 'job_status', label = 'job_status',
    choices = E'queued\nrunning\ndone\nfailed', default_value = 'queued'
  where parent = 'Background Job' and column_name = 'status';
update column_def set column_name = 'target_status', label = 'target_status',
    choices = E'draft\nsubmitted\ncancelled', default_value = 'draft'
  where parent = 'Workflow Document State' and column_name = 'doc_status';

-- The remaining "which Table does this row point at" columns, renamed to
-- the one canonical spelling `ref_table` (webhook keeps its prefix).
update column_def set column_name = 'ref_table', label = 'ref_table'
  where column_name = 'document_type'
    and parent in ('Assignment Rule', 'Email Rule', 'Service Level Agreement', 'Web Form', 'Workflow');
update column_def set column_name = 'ref_table', label = 'ref_table'
  where column_name = 'reference_doctype'
    and parent in ('Access Log', 'Client Script', 'Email Queue', 'Server Script', 'ToDo');
update column_def set column_name = 'ref_table', label = 'ref_table'
  where parent = 'Print Format' and column_name = 'doc_type';
update column_def set column_name = 'webhook_table', label = 'webhook_table'
  where parent = 'Webhook' and column_name = 'webhook_doctype';

-- Installed App's ledger of owned tables.
update column_def set column_name = 'tables', label = 'tables'
  where parent = 'Installed App' and column_name = 'doctypes';

-- Rename the actual permission/share/data_scope tables' columns too (they
-- went through the same bolt-on standard-columns treatment as any Table).
do $$
declare tbl text;
begin
  foreach tbl in array array['permission', 'share', 'data_scope'] loop
    if to_regclass(tbl) is null then continue; end if;
    if exists (select 1 from information_schema.columns where table_name=tbl and column_name='owner') then
      execute format('alter table %I rename column owner to created_by', tbl);
    end if;
    if exists (select 1 from information_schema.columns where table_name=tbl and column_name='modified_by') then
      execute format('alter table %I rename column modified_by to updated_by', tbl);
    end if;
    if exists (select 1 from information_schema.columns where table_name=tbl and column_name='creation') then
      execute format('alter table %I rename column creation to created_at', tbl);
    end if;
    if exists (select 1 from information_schema.columns where table_name=tbl and column_name='modified') then
      execute format('alter table %I rename column modified to updated_at', tbl);
    end if;
    if exists (select 1 from information_schema.columns where table_name=tbl and column_name='idx') then
      execute format('alter table %I rename column idx to position', tbl);
    end if;
    if exists (select 1 from information_schema.columns where table_name=tbl and column_name='docstatus') then
      execute format('alter table %I add column if not exists status text', tbl);
      execute format(
        'update %I set status = case docstatus when 0 then ''draft'' when 1 then ''submitted'' when 2 then ''cancelled'' else ''draft'' end',
        tbl);
      execute format('alter table %I alter column status set default ''draft'', alter column status set not null', tbl);
      execute format('alter table %I drop column docstatus', tbl);
    end if;
    if exists (select 1 from information_schema.columns where table_name=tbl and column_name='ref_doctype') then
      execute format('alter table %I rename column ref_doctype to ref_table', tbl);
    end if;
    if exists (select 1 from information_schema.columns where table_name=tbl and column_name='share_doctype') then
      execute format('alter table %I rename column share_doctype to share_table', tbl);
    end if;
    if exists (select 1 from information_schema.columns where table_name=tbl and column_name='allow') then
      execute format('alter table %I rename column allow to allow_table', tbl);
    end if;
    if exists (select 1 from information_schema.columns where table_name=tbl and column_name='permlevel') then
      execute format('alter table %I add column if not exists tier text', tbl);
      execute format('update %I set tier = case when permlevel > 0 then ''restricted'' else ''basic'' end', tbl);
      execute format('alter table %I alter column tier set not null, alter column tier set default ''basic''', tbl);
      execute format('alter table %I drop column permlevel', tbl);
    end if;
    if exists (select 1 from information_schema.columns where table_name=tbl and column_name='if_owner') then
      execute format('alter table %I rename column if_owner to own_rows_only', tbl);
    end if;
  end loop;
end $$;

-- ============================================================
-- 2c. PHYSICAL parity for the same engine Tables (still tab_-prefixed at
--     this point — section 3 drops the prefix). The domain `status` renames
--     MUST run before section 3's docstatus conversion: that conversion
--     does `add column if not exists status` + overwrite, which would
--     silently destroy queue/ticket/todo/job state if a domain column
--     still occupied the `status` name.
-- ============================================================
do $$
declare
  t record;
begin
  -- Domain status columns stepping aside for the standard row lifecycle.
  for t in select * from (values
    ('tab_email_queue', 'status', 'send_status'),
    ('tab_hd_ticket', 'status', 'ticket_status'),
    ('tab_todo', 'status', 'todo_status'),
    ('tab_background_job', 'status', 'job_status'),
    ('tab_workflow_document_state', 'doc_status', 'target_status'),
    -- "which Table does this row point at" -> canonical ref_table
    ('tab_assignment_rule', 'document_type', 'ref_table'),
    ('tab_email_rule', 'document_type', 'ref_table'),
    ('tab_service_level_agreement', 'document_type', 'ref_table'),
    ('tab_web_form', 'document_type', 'ref_table'),
    ('tab_workflow', 'document_type', 'ref_table'),
    ('tab_access_log', 'reference_doctype', 'ref_table'),
    ('tab_client_script', 'reference_doctype', 'ref_table'),
    ('tab_email_queue', 'reference_doctype', 'ref_table'),
    ('tab_server_script', 'reference_doctype', 'ref_table'),
    ('tab_todo', 'reference_doctype', 'ref_table'),
    ('tab_comment', 'ref_doctype', 'ref_table'),
    ('tab_report', 'ref_doctype', 'ref_table'),
    ('tab_file', 'ref_doctype', 'ref_table'),
    ('tab_notification_log', 'ref_doctype', 'ref_table'),
    ('tab_version', 'ref_doctype', 'ref_table'),
    ('tab_workflow_action', 'ref_doctype', 'ref_table'),
    ('tab_print_format', 'doc_type', 'ref_table'),
    ('tab_webhook', 'webhook_doctype', 'webhook_table'),
    ('tab_installed_app', 'doctypes', 'tables'),
    -- Custom Field mirrors Column's fieldname/fieldtype rename.
    ('tab_custom_field', 'fieldname', 'column_name'),
    ('tab_custom_field', 'fieldtype', 'column_type')
  ) as v(tbl, old_col, new_col)
  loop
    if to_regclass(t.tbl) is not null
       and exists (select 1 from information_schema.columns where table_name = t.tbl and column_name = t.old_col)
       and not exists (select 1 from information_schema.columns where table_name = t.tbl and column_name = t.new_col) then
      execute format('alter table %I rename column %I to %I', t.tbl, t.old_col, t.new_col);
    end if;
  end loop;
end $$;

-- Workflow Document State's target state: values move with the docstatus ->
-- status vocabulary (0/1/2 -> draft/submitted/cancelled).
do $$
begin
  if to_regclass('tab_workflow_document_state') is not null
     and exists (select 1 from information_schema.columns where table_name='tab_workflow_document_state' and column_name='target_status') then
    update tab_workflow_document_state set target_status = case target_status
      when '0' then 'draft' when '1' then 'submitted' when '2' then 'cancelled'
      else target_status end;
  end if;
end $$;

-- Custom Field's overloaded `options` splits into the three targeted
-- columns, exactly as column_def's did in section 1.
do $$
begin
  if to_regclass('tab_custom_field') is not null
     and exists (select 1 from information_schema.columns where table_name='tab_custom_field' and column_name='options') then
    alter table tab_custom_field add column if not exists reference_table text;
    alter table tab_custom_field add column if not exists choices text;
    alter table tab_custom_field add column if not exists row_table text;
    update tab_custom_field set column_type = 'Reference' where column_type = 'Link';
    update tab_custom_field set column_type = 'Choice' where column_type = 'Select';
    update tab_custom_field set column_type = 'Sub-table' where column_type = 'Table';
    update tab_custom_field set reference_table = options where column_type = 'Reference';
    update tab_custom_field set choices = options where column_type = 'Choice';
    update tab_custom_field set row_table = options where column_type = 'Sub-table';
    alter table tab_custom_field drop column options;
  end if;
end $$;

-- Data values in the permission tables that point at the renamed system
-- entities by name.
do $$
declare
  pair record;
begin
  for pair in select * from (values
    ('DocType', 'Table'), ('DocField', 'Column'), ('DocPerm', 'Permission'),
    ('DocShare', 'Share'), ('User Permission', 'Data Scope'),
    ('Property Setter', 'Metadata Override')
  ) as v(old_name, new_name)
  loop
    if to_regclass('permission') is not null
       and exists (select 1 from information_schema.columns where table_name='permission' and column_name='ref_table') then
      execute format('update permission set ref_table = %L where ref_table = %L', pair.new_name, pair.old_name);
    end if;
    if to_regclass('share') is not null
       and exists (select 1 from information_schema.columns where table_name='share' and column_name='share_table') then
      execute format('update share set share_table = %L where share_table = %L', pair.new_name, pair.old_name);
    end if;
    if to_regclass('data_scope') is not null
       and exists (select 1 from information_schema.columns where table_name='data_scope' and column_name='allow_table') then
      execute format('update data_scope set allow_table = %L where allow_table = %L', pair.new_name, pair.old_name);
    end if;
  end loop;
end $$;

-- ============================================================
-- 3. Every other dynamically-created "tab_<name>" table: drop the prefix
--    and rename the standard columns.
-- ============================================================
do $$
declare
  r record;
  old_name text;
  new_name text;
begin
  for r in select table_name from information_schema.tables
           where table_schema = 'public' and table_name ~ '^tab_'
  loop
    old_name := r.table_name;
    new_name := substring(old_name from 5); -- drop 'tab_' prefix
    execute format('alter table %I rename to %I', old_name, new_name);

    if exists (select 1 from information_schema.columns where table_name=new_name and column_name='owner') then
      execute format('alter table %I rename column owner to created_by', new_name);
    end if;
    if exists (select 1 from information_schema.columns where table_name=new_name and column_name='modified_by') then
      execute format('alter table %I rename column modified_by to updated_by', new_name);
    end if;
    if exists (select 1 from information_schema.columns where table_name=new_name and column_name='creation') then
      execute format('alter table %I rename column creation to created_at', new_name);
    end if;
    if exists (select 1 from information_schema.columns where table_name=new_name and column_name='modified') then
      execute format('alter table %I rename column modified to updated_at', new_name);
    end if;
    if exists (select 1 from information_schema.columns where table_name=new_name and column_name='idx') then
      execute format('alter table %I rename column idx to position', new_name);
    end if;
    if exists (select 1 from information_schema.columns where table_name=new_name and column_name='docstatus') then
      execute format('alter table %I add column if not exists status text', new_name);
      execute format(
        'update %I set status = case docstatus when 0 then ''draft'' when 1 then ''submitted'' when 2 then ''cancelled'' else ''draft'' end',
        new_name);
      execute format('alter table %I alter column status set default ''draft'', alter column status set not null', new_name);
      execute format('alter table %I drop column docstatus', new_name);
    end if;
  end loop;
end $$;

-- ============================================================
-- 4. Plain infra tables (not Tables themselves, so not tab_-prefixed) that
--    still reference the old vocabulary in their own column names.
-- ============================================================
do $$
begin
  if exists (select 1 from information_schema.columns where table_name='user_settings' and column_name='doctype') then
    alter table user_settings rename column doctype to table_name;
  end if;
  if exists (select 1 from information_schema.columns where table_name='user_settings' and column_name='modified') then
    alter table user_settings rename column modified to updated_at;
  end if;
  if exists (select 1 from information_schema.columns where table_name='tag_link' and column_name='ref_doctype') then
    alter table tag_link rename column ref_doctype to ref_table;
  end if;
  if exists (select 1 from information_schema.columns where table_name='tag_link' and column_name='owner') then
    alter table tag_link rename column owner to created_by;
  end if;
  if exists (select 1 from information_schema.columns where table_name='tag_link' and column_name='creation') then
    alter table tag_link rename column creation to created_at;
  end if;
  if exists (select 1 from information_schema.columns where table_name='single_value' and column_name='doctype') then
    alter table single_value rename column doctype to table_name;
  end if;
end $$;

-- Property Setter -> Metadata Override, doc_type/field_name -> table_name/column_name.
do $$
begin
  if to_regclass('property_setter') is not null then
    execute 'alter table property_setter rename to metadata_override';
  end if;
  if exists (select 1 from information_schema.columns where table_name='metadata_override' and column_name='doc_type') then
    alter table metadata_override rename column doc_type to table_name;
  end if;
  if exists (select 1 from information_schema.columns where table_name='metadata_override' and column_name='field_name') then
    alter table metadata_override rename column field_name to column_name;
  end if;
end $$;
update column_def set parent = 'Metadata Override' where parent = 'Property Setter';
update table_def set name = 'Metadata Override' where name = 'Property Setter';
update column_def set reference_table = 'Table' where parent = 'Metadata Override' and reference_table = 'DocType';

-- The two ALTERs above renamed the PHYSICAL columns on metadata_override;
-- the column_def METADATA rows describing those columns need the same
-- rename, or getMeta('Metadata Override') keeps validating against the old
-- names and every save 417s with "Unknown fields".
update column_def set column_name = 'table_name' where parent = 'Metadata Override' and column_name = 'doc_type';
update column_def set column_name = 'column_name' where parent = 'Metadata Override' and column_name = 'field_name';

-- Both renames above are done and consistent — safe to reinstate the FK.
alter table column_def
  add constraint column_def_parent_fkey foreign key (parent) references table_def(name) on delete cascade;

-- ============================================================
-- 5. RLS: regenerate fc_has_read() against the renamed permission table,
--    and refresh every existing SELECT policy (they were created with the
--    old table/column names baked into their predicate).
-- ============================================================
-- The pre-rename function was declared with a different parameter name, and
-- CREATE OR REPLACE cannot rename parameters (42P13). Drop it outright; the
-- CASCADE takes the old policies with it, and the loop below recreates a
-- fresh policy for every Table either way.
drop function if exists fc_has_read(text) cascade;

create function fc_has_read(tbl text) returns boolean
language sql stable security definer set search_path = public
as $$
  select fc_session_user() = 'Administrator'
    or exists (
      select 1
      from permission p
      join has_role hr
        on hr.role = p.role
       and hr.parenttype = 'User'
       and hr.parent = fc_session_user()
      where p.ref_table = tbl
        and coalesce(p.tier, 'basic') = 'basic'
        and p.can_read
    )
$$;

do $$
declare
  r record;
  tbl text;
begin
  create temp table _rls_tables on commit drop as
    select name, kind from table_def where kind != 'settings';
  for r in select name, kind from _rls_tables loop
    tbl := lower(regexp_replace(r.name, '\s+', '_', 'g'));
    if to_regclass(tbl) is null then continue; end if;
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists fc_select on %I', tbl);
    if r.kind = 'sub_table' then
      execute format(
        'create policy fc_select on %I for select to desk_client using (fc_has_read(parenttype))',
        tbl);
    else
      execute format(
        'create policy fc_select on %I for select to desk_client using (fc_has_read(%L))',
        tbl, r.name);
    end if;
    execute format('grant select on %I to desk_client', tbl);
  end loop;
end $$;
