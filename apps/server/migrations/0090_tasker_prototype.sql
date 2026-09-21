-- One local prototype transition, not a general app upgrade mechanism.
-- Preserve row IDs, physical rows, grants and metadata-backed Table pointers.
do $$
declare
  mapping record;
  pointer record;
  old_app installed_app%rowtype;
begin
  select * into old_app from installed_app where name = 'task-management';
  if not found then return; end if;
  if old_app.tables <> '["Team Project", "Team Task"]'::jsonb then
    raise exception 'Tasker prototype ownership differs; inspect before transitioning';
  end if;
  if exists(select 1 from installed_app where name = 'tasker')
    or exists(select 1 from table_def where name in ('tasker.task', 'tasker.project'))
    or to_regclass('tasker.task') is not null or to_regclass('tasker.project') is not null then
    raise exception 'Tasker destination already exists; refusing to merge or discard prototype rows';
  end if;
  create schema if not exists tasker;
  for mapping in select * from (values
    ('Team Project', 'team_project', 'tasker.project', 'project', 'Project'),
    ('Team Task', 'team_task', 'tasker.task', 'task', 'Task')
  ) as m(old_name, old_relation, new_name, new_relation, label)
  loop
    if not exists(select 1 from table_def where name = mapping.old_name) then
      raise exception 'Missing prototype Table %', mapping.old_name;
    end if;
    execute format('alter table public.%I set schema tasker', mapping.old_relation);
    execute format('alter table tasker.%I rename to %I', mapping.old_relation, mapping.new_relation);
    insert into table_def
      select (jsonb_populate_record(null::table_def, to_jsonb(t) || jsonb_build_object(
        'name', mapping.new_name, 'label', mapping.label, 'owner_app', 'tasker',
        'physical_schema', 'tasker', 'physical_relation', mapping.new_relation, 'module', 'Tasker'
      ))).* from table_def t where name = mapping.old_name;
    update column_def set parent = mapping.new_name where parent = mapping.old_name;
    update column_def set reference_table = mapping.new_name where reference_table = mapping.old_name;
    update column_def set row_table = mapping.new_name where row_table = mapping.old_name;
    for pointer in
      select cd.column_name, coalesce(td.physical_schema, 'public') as schema_name,
        coalesce(td.physical_relation, lower(replace(td.name, ' ', '_'))) as relation_name
      from column_def cd join table_def td on td.name = cd.parent
      where cd.column_type = 'Reference' and cd.reference_table = 'Table'
        and td.data_source is null and td.kind <> 'settings'
    loop
      execute format('update %I.%I set %I = $1 where %I = $2',
        pointer.schema_name, pointer.relation_name, pointer.column_name, pointer.column_name)
        using mapping.new_name, mapping.old_name;
    end loop;
    update user_settings set table_name = mapping.new_name where table_name = mapping.old_name;
    update tag_link set ref_table = mapping.new_name where ref_table = mapping.old_name;
    update saved_view set ref_table = mapping.new_name where ref_table = mapping.old_name;
    delete from table_def where name = mapping.old_name;
    execute format('drop policy if exists fc_select on tasker.%I', mapping.new_relation);
    execute format('create policy fc_select on tasker.%I for select to app_client using (fc_has_read(%L))',
      mapping.new_relation, mapping.new_name);
  end loop;
  grant usage on schema tasker to app_client;
  update installed_app set name = 'tasker', tables = '["tasker.project", "tasker.task"]'::jsonb,
    runtime_package = true where name = 'task-management';
end $$;
