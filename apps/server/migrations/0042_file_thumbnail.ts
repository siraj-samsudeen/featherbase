// FILE-004: give the File DocType a `thumbnail_url` holding a small inline
// (data-URI) preview generated for image uploads. Idempotent: adds the column
// and docfield only if missing.
import { sql } from '../src/db'
import { columnType } from '../src/doctype-engine'

export async function up() {
  const [f] = await sql`select 1 from tab_doctype where name = 'File'`
  if (!f) return

  const existing = await sql`select fieldname from tab_docfield where parent = 'File'`
  const have = new Set(existing.map((r) => r.fieldname as string))
  if (have.has('thumbnail_url')) return

  const [{ maxidx }] = await sql`select coalesce(max(idx), 0)::int as maxidx from tab_docfield where parent = 'File'`
  // Long Text → text column, big enough for a base64 data URI.
  const type = columnType('Long Text')
  if (type) await sql.unsafe(`alter table tab_file add column if not exists "thumbnail_url" ${type}`)
  await sql`insert into tab_docfield ${sql({
    parent: 'File',
    idx: (maxidx as number) + 1,
    fieldname: 'thumbnail_url',
    label: 'Thumbnail',
    fieldtype: 'Long Text',
    options: null,
    reqd: false,
    unique: false,
    default_value: null,
    read_only: true,
    hidden: false,
    in_list_view: false,
    permlevel: 0,
  })}`
}
