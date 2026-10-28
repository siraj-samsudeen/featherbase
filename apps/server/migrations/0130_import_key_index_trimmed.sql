-- #517: an import's match key is compared with its surrounding whitespace
-- trimmed, so the on-demand key index (collection-import.ts ensureKeyIndex)
-- is now built on the trimmed text. An index built before on the untrimmed
-- cast serves no query and only slows writes; drop each one. The next keyed
-- import on that column builds the trimmed index under the same name.
do $$
declare
  ix record;
begin
  for ix in
    select schemaname, indexname from pg_indexes
    where indexname like '%\_ukidx' escape '\'
      and indexdef not like '%btrim(%'
  loop
    execute format('drop index if exists %I.%I', ix.schemaname, ix.indexname);
  end loop;
end $$;
