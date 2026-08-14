// DocType→Table, the stored-data corner: a Home Page shortcut records what it
// points at in `home_page.shortcuts` (jsonb) as `type: 'doctype' | 'report' |
// 'dashboard' | 'url'`. The code now reads `'table'`, so rows written before
// this change would stop resolving — a shortcut would silently fall through
// to the untouched pass-through branch instead of getting the read filter.
//
// Like 0078, this is a key/value INSIDE a jsonb document, invisible to any
// column rename. Idempotent: only elements still saying 'doctype' are
// rewritten, so a second run changes nothing.
import { sql } from '../src/db'

export async function up() {
  const [present] = await sql`select to_regclass('home_page') as reg`
  if (!present?.reg) return

  await sql`
    update home_page
    set shortcuts = (
      select jsonb_agg(
        case
          when elem ->> 'type' = 'doctype' then jsonb_set(elem, '{type}', '"table"')
          else elem
        end
        order by ord
      )
      from jsonb_array_elements(shortcuts) with ordinality as t(elem, ord)
    )
    where shortcuts is not null
      and jsonb_typeof(shortcuts) = 'array'
      and exists (
        select 1 from jsonb_array_elements(shortcuts) e where e ->> 'type' = 'doctype'
      )`
}
