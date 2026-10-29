// What two databases are compared by when one should be the other (#692): a
// fresh install from the baseline against one adopted from the migrations it
// replaced, or a database before and after a run that should change nothing.
import type postgres from 'postgres'

type Db = postgres.Sql<Record<string, never>> | postgres.Sql

/** Every column, constraint, index, trigger, policy, function, extension and
 *  schema grant of the platform's schemas, one line each, sorted. */
export async function schemaShape(db: Db): Promise<string[]> {
  return (await db`
    select format('column %s.%s.%s %s %s %s', table_schema, table_name, column_name, data_type, is_nullable, coalesce(column_default, '')) as x
      from information_schema.columns where table_schema in ('featherbase', 'meta', 'public')
    union all select format('constraint %s %s %s', conrelid::regclass, conname, pg_get_constraintdef(oid)) from pg_constraint
      where connamespace in ('featherbase'::regnamespace, 'public'::regnamespace)
    union all select format('index %s', indexdef) from pg_indexes where schemaname in ('featherbase', 'public')
    union all select format('trigger %s', pg_get_triggerdef(t.oid)) from pg_trigger t
      join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace = 'featherbase'::regnamespace
    union all select format('policy %s.%s %s %s %s', tablename, policyname, cmd, roles, qual) from pg_policies where schemaname = 'featherbase'
    union all select format('row security %s %s', oid::regclass, relrowsecurity) from pg_class
      where relnamespace = 'featherbase'::regnamespace and relkind = 'r'
    union all select format('function %s', pg_get_functiondef(p.oid)) from pg_proc p
      where p.pronamespace = 'featherbase'::regnamespace and p.prokind = 'f'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    union all select format('extension %s in %s', extname, extnamespace::regnamespace) from pg_extension
    union all select format('schema %s %s', nspname, nspacl) from pg_namespace where nspname in ('featherbase', 'meta', 'public')
    order by 1`).map((r) => String(r.x))
}

// The install's clock, salted hashes, and ids drawn at random per install.
const VARYING = new Set(['created_at', 'updated_at', 'applied_at', 'password_hash'])
const RANDOM_ID_TABLES = new Set(['column_def', 'has_role', 'home_page_link'])
// The runner's own records, and the retired patch runner's.
const NOT_SEED = new Set(['featherbase.migration', 'featherbase.internal_metadata', 'featherbase.patch_log'])

/** Every row of every platform table, the varying columns left out, sorted:
 *  table → rows as JSON. */
export async function seedRows(db: Db): Promise<Record<string, string[]>> {
  const tables = await db`
    select c.oid, n.nspname || '.' || c.relname as relation from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('featherbase', 'meta', 'public') order by 2`
  const out: Record<string, string[]> = {}
  for (const t of tables) {
    const relation = String(t.relation)
    if (NOT_SEED.has(relation)) continue
    const columns = (await db`select attname from pg_attribute where attrelid = ${t.oid} and attnum > 0 and not attisdropped order by attnum`)
      .map((r) => String(r.attname))
      .filter((c) => !VARYING.has(c) && !(c === 'row_id' && RANDOM_ID_TABLES.has(relation.split('.')[1])))
    const rows = await db.unsafe(`select ${columns.map((c) => `"${c}"`).join(', ')} from ${relation}`)
    if (rows.length) out[relation] = rows.map((r) => JSON.stringify(r)).sort()
  }
  return out
}
