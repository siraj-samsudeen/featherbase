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

update table_def set name = 'Table' where name = 'DocType';
update table_def set name = 'Column' where name = 'DocField';
update table_def set name = 'Permission' where name = 'DocPerm';
update table_def set name = 'Share' where name = 'DocShare';
update table_def set name = 'Data Scope' where name = 'User Permission';

update column_def set parent = 'Table' where parent = 'DocType';
update column_def set parent = 'Column' where parent = 'DocField';
update column_def set parent = 'Permission' where parent = 'DocPerm';
update column_def set parent = 'Share' where parent = 'DocShare';
update column_def set parent = 'Data Scope' where parent = 'User Permission';

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
    update column_def set column_name = 'reference_table' where parent = 'Permission' and column_name = 'ref_doctype';
    update column_def set reference_table = 'Table' where parent = 'Permission' and column_name = 'reference_table';
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
           where table_schema = 'public' and table_name like 'tab_%'
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
update table_def set name = 'Metadata Override' where name = 'Property Setter';
update column_def set parent = 'Metadata Override' where parent = 'Property Setter';
update column_def set reference_table = 'Table' where parent = 'Metadata Override' and reference_table = 'DocType';

-- ============================================================
-- 5. RLS: regenerate fc_has_read() against the renamed permission table,
--    and refresh every existing SELECT policy (they were created with the
--    old table/column names baked into their predicate).
-- ============================================================
create or replace function fc_has_read(tbl text) returns boolean
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
