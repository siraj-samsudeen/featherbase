// RPT-004: Query Reports — a Report can carry admin-authored SQL. Adds
// report_type (Report Builder | Query Report) and the query text. Idempotent:
// only inserts docfields that are missing.
import { sql } from '../src/db'
import { columnType } from '../src/doctype-engine'

const NEW_FIELDS = [
  { fieldname: 'report_type', fieldtype: 'Select', label: 'Report Type', options: 'Report Builder\nQuery Report', default_value: 'Report Builder' },
  { fieldname: 'query', fieldtype: 'Long Text', label: 'Query', options: null, default_value: null },
]

export async function up() {
  const [rt] = await sql`select 1 from tab_doctype where name = 'Report'`
  if (!rt) return

  const existing = await sql`select fieldname from tab_docfield where parent = 'Report'`
  const have = new Set(existing.map((r) => r.fieldname as string))
  const [{ maxidx }] = await sql`select coalesce(max(idx), 0)::int as maxidx from tab_docfield where parent = 'Report'`
  let idx = maxidx as number

  for (const f of NEW_FIELDS) {
    // Report is a normal (non-single) DocType, so each field also needs its
    // backing column on tab_report. `add column if not exists` is idempotent,
    // so this also repairs a docfield that was added without its column.
    const type = columnType(f.fieldtype)
    if (type) await sql.unsafe(`alter table tab_report add column if not exists "${f.fieldname}" ${type}`)

    if (have.has(f.fieldname)) continue
    idx += 1
    await sql`insert into tab_docfield ${sql({
      parent: 'Report',
      idx,
      fieldname: f.fieldname,
      label: f.label,
      fieldtype: f.fieldtype,
      options: f.options,
      reqd: false,
      unique: false,
      default_value: f.default_value,
      read_only: false,
      hidden: false,
      in_list_view: false,
      permlevel: 0,
    })}`
  }
}
