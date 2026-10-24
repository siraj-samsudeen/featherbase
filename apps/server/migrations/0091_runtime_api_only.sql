-- Raw SQL cannot participate in process-local runtime package availability.
-- Generic APIs remain the supported read/write surface for app-owned Tables,
-- so no role but the owner holds any privilege on their relations.
do $$
declare r record;
begin
  for r in select physical_schema, physical_relation from table_def where owner_app is not null loop
    execute format('revoke all on %I.%I from public', r.physical_schema, r.physical_relation);
  end loop;
end $$;
