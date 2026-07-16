// API-007: per-user API rate-limit budget (requests per window; 0 = global
// default). Idempotent docfield + backing column on tab_user.
import { sql } from '../src/db'
import { columnType } from '../src/doctype-engine'

export async function up() {
  const type = columnType('Int')
  if (type) await sql.unsafe(`alter table tab_user add column if not exists "api_rate_limit" ${type}`)
  const [f] = await sql`select 1 from tab_docfield where parent = 'User' and fieldname = 'api_rate_limit'`
  if (f) return
  const [{ maxidx }] = await sql`select coalesce(max(idx), 0)::int as maxidx from tab_docfield where parent = 'User'`
  await sql`insert into tab_docfield ${sql({
    parent: 'User',
    idx: (maxidx as number) + 1,
    fieldname: 'api_rate_limit',
    label: 'API Rate Limit (per minute)',
    fieldtype: 'Int',
    options: null,
    reqd: false,
    unique: false,
    default_value: '0',
    read_only: false,
    hidden: false,
    in_list_view: false,
    permlevel: 0,
  })}`
}
