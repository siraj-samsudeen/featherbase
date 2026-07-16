// SET-004: System Settings gains the fields that drive global rendering —
// currency, decimal precision for Currency/Float, and the session lifetime.
// Idempotent: only inserts docfields that are not already present. Singles
// have no table, so this is pure metadata (tab_docfield) — no column DDL.
import { sql } from '../src/db'

const NEW_FIELDS = [
  { fieldname: 'currency', fieldtype: 'Select', label: 'Default Currency', options: 'USD\nEUR\nGBP\nINR\nJPY', default_value: 'USD' },
  { fieldname: 'currency_precision', fieldtype: 'Int', label: 'Currency Precision', options: null, default_value: '2' },
  { fieldname: 'float_precision', fieldtype: 'Int', label: 'Float Precision', options: null, default_value: '2' },
]

export async function up() {
  const [ss] = await sql`select 1 from tab_doctype where name = 'System Settings'`
  if (!ss) return // 0024 not applied (fresh non-single install) — nothing to extend

  const existing = await sql`select fieldname from tab_docfield where parent = 'System Settings'`
  const have = new Set(existing.map((r) => r.fieldname as string))
  const [{ maxidx }] = await sql`select coalesce(max(idx), 0)::int as maxidx from tab_docfield where parent = 'System Settings'`
  let idx = maxidx as number

  for (const f of NEW_FIELDS) {
    if (have.has(f.fieldname)) continue
    idx += 1
    await sql`insert into tab_docfield ${sql({
      parent: 'System Settings',
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
