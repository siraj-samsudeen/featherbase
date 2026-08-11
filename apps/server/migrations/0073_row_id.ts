// #132: rename the physical row key `name` -> `row_id` on every generated
// table, finishing the "Row ID" rename that had only ever reached the UI
// vocabulary. With `name` no longer reserved, a user Table may finally carry
// the most natural column name there is (Student.name, Customer.name).
//
// Two tables are deliberately NOT renamed:
//   * `table_def` — its `name` is a NATURAL key holding the Table's own
//     identifier ('Student'), the target of column_def's foreign key and what
//     `reference_table`, `row_table`, `parenttype` and `permission.table` all
//     point at. That identifier is a different concept from a row id and is
//     out of scope for #132. The engine maps it to the wire key `row_id`
//     (see physicalRowKey in src/meta.ts), so the API shape stays uniform.
//   * engine-owned RAW tables (`series`, `migration`, `installed_app`,
//     `site`, `single_value`, `password_reset`, `tag_link`, `access_token`)
//     — they carry no table_def row and their `name` means something else
//     entirely (a series prefix, a migration filename, an app id).
//
// A FRESH database never needs the rename: createTableDDL already emits
// `row_id`, and 0002 now creates column_def that way. So every step here is
// conditional, and the whole migration is a no-op on a new checkout.
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

export async function up() {
  // Every table backing a Table definition whose single-column PRIMARY KEY is
  // still literally `name`. Keying off the primary key (rather than "has a
  // column called name") is what makes this safe to re-run in a world where a
  // user column may now legitimately be called `name`.
  const targets = await sql<{ table_name: string }[]>`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_constraint pc on pc.conrelid = c.oid and pc.contype = 'p'
    where n.nspname = current_schema()
      and c.relkind = 'r'
      and array_length(pc.conkey, 1) = 1
      and (select a.attname from pg_attribute a
           where a.attrelid = c.oid and a.attnum = pc.conkey[1]) = 'name'
      and c.relname <> 'table_def'
      and exists (
        select 1 from table_def td
        where lower(replace(td.name, ' ', '_')) = c.relname
           or (td.name = 'Column' and c.relname = 'column_def'))
    order by c.relname`

  for (const t of targets)
    await sql.unsafe(`alter table "${t.table_name}" rename column "name" to "row_id"`)

  // Metadata that NAMES the row-key column by string. `sort_column` defaults
  // to updated_at, but a Table may have been pointed at the key itself; a
  // `title_column` of 'name' likewise meant "show the Row ID".
  await sql`update table_def set sort_column = 'row_id' where sort_column = 'name'`
  await sql`update table_def set title_column = 'row_id' where title_column = 'name'`

  // An id_pattern of field:name named rows after the key itself — incoherent
  // before and after, but rewrite it so it keeps resolving to the same column.
  await sql`update table_def set id_pattern = 'field:row_id' where id_pattern = 'field:name'`

  // Stored, data-driven references to the key: Saved View filters are
  // [field, op, value] triples authored by the Desk, and print/email templates
  // interpolate {{ name }} / {{ doc.name }}.
  await sql`
    update saved_view set filters = replace(filters, '["name",', '["row_id",')
    where filters like '%["name",%'`
  await sql`
    update print_format set template = replace(template, '{{ name }}', '{{ row_id }}')
    where template like '%{{ name }}%'`
  await sql`
    update email_rule set body = replace(body, '{{ doc.name }}', '{{ doc.row_id }}')
    where body like '%{{ doc.name }}%'`
  await sql`
    update email_rule set subject = replace(subject, '{{ doc.name }}', '{{ doc.row_id }}')
    where subject like '%{{ doc.name }}%'`

  invalidateMeta()
}
