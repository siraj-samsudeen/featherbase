// API-007: per-user API rate-limit budget (requests per window; 0 = global
// default). Idempotent column_def + backing column on "user".
import { sql } from '../src/db'
import { pgType } from '../src/table-engine'

export async function up() {
  const type = pgType('Int')
  if (type) await sql.unsafe(`alter table "user" add column if not exists "api_rate_limit" ${type}`)
  const [f] = await sql`select 1 from column_def where parent = 'User' and column_name = 'api_rate_limit'`
  if (f) return
  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'User'`
  await sql`insert into column_def ${sql({
    parent: 'User',
    position: (maxidx as number) + 1,
    column_name: 'api_rate_limit',
    label: 'API Rate Limit (per minute)',
    column_type: 'Int',
    reqd: false,
    unique: false,
    default_value: '0',
    read_only: false,
    hidden: false,
    in_list_view: false,
    tier: 'basic',
  })}`
}
