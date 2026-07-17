// DOC-008: backfill amended_from on submittable DocTypes created before the
// engine auto-added it.
import { sql } from '../src/db'
import { tableName } from '../src/doctype-engine'
import { invalidateMeta } from '../src/meta'

export async function up() {
  const doctypes = await sql`
    select name from tab_doctype where is_submittable = true and issingle = false`
  for (const dt of doctypes) {
    const name = dt.name as string
    const [field] = await sql`
      select 1 from tab_docfield where parent = ${name} and fieldname = 'amended_from'`
    if (field) continue
    const [{ max }] = await sql`
      select coalesce(max(idx), 0)::int as max from tab_docfield where parent = ${name}`
    await sql`insert into tab_docfield ${sql({
      parent: name,
      idx: (max as number) + 1,
      fieldname: 'amended_from',
      label: 'Amended From',
      fieldtype: 'Link',
      options: name,
      hidden: true,
    })}`
    await sql.unsafe(
      `alter table "${tableName(name)}" add column if not exists "amended_from" varchar(140)`,
    )
    invalidateMeta(name)
  }
}
