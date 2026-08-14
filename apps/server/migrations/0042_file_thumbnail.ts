// FILE-004: give the File Table a `thumbnail_url` holding a small inline
// (data-URI) preview generated for image uploads. Idempotent: adds the column
// and column_def only if missing.
import { sql } from '../src/db'
import { pgType } from '../src/table-engine'

export async function up() {
  const [f] = await sql`select 1 from table_def where name = 'File'`
  if (!f) return

  const existing = await sql`select column_name from column_def where parent = 'File'`
  const have = new Set(existing.map((r) => r.column_name as string))
  if (have.has('thumbnail_url')) return

  const [{ maxidx }] = await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'File'`
  // Long Text → text column, big enough for a base64 data URI.
  const type = pgType('Long Text')
  if (type) await sql.unsafe(`alter table file add column if not exists "thumbnail_url" ${type}`)
  await sql`insert into column_def ${sql({
    parent: 'File',
    position: (maxidx as number) + 1,
    column_name: 'thumbnail_url',
    label: 'Thumbnail',
    column_type: 'Long Text',
    reqd: false,
    unique: false,
    default_value: null,
    read_only: true,
    hidden: false,
    in_list_view: false,
    tier: 'basic',
  })}`
}
