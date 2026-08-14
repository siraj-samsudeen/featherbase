// #132 follow-through: the import log's `touched` payload still spelled the
// row id `name`, the one place the rename could not reach — 0077 renames
// COLUMNS, and this is a key inside a jsonb document, invisible to
// `alter table ... rename column`.
//
// Wiping the log was authorised, but rewriting is barely longer and keeps
// every recorded run revertable: a wipe would silently strip the revert
// affordance from runs that already happened.
//
// Idempotent by construction — it only touches array elements that still
// carry a `name` key, so a second run rewrites nothing.
import { sql } from '../src/db'

export async function up() {
  // The table only exists once 'Import Log' has been installed (0069/0073).
  const [present] = await sql`select to_regclass('import_log') as reg`
  if (!present?.reg) return

  await sql`
    update import_log
    set touched = (
      select jsonb_agg(
        case
          when elem ? 'name'
            then (elem - 'name') || jsonb_build_object('row_id', elem -> 'name')
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(touched) with ordinality as t(elem, ord)
    )
    where touched is not null
      and jsonb_typeof(touched) = 'array'
      and exists (
        select 1 from jsonb_array_elements(touched) e where e ? 'name'
      )`
}
