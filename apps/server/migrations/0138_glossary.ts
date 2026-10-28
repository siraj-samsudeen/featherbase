// #629: the glossary. One platform Table of terms, each with its words to
// avoid and the Tables and columns it describes (two Sub-tables). A term an
// app ships carries the app's name and the app's last shipped wording, so an
// upgrade can tell a term the instance reworded from one it did not. A term
// with no app is the instance's own.
//
// Everyone signed in reads the glossary (a read grant to All, written here
// once; an instance may withdraw it). Editing is a write grant on Glossary
// Term, which System Managers always hold.
//
// All new; no existing data is rewritten.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'

export async function up() {
  const [avoid] = await sql`select 1 from table_def where name = 'Glossary Avoid Word'`
  if (!avoid) {
    await createTable({
      name: 'Glossary Avoid Word',
      module: 'Core',
      kind: 'sub_table',
      system: true,
      columns: [
        { column_name: 'word', label: 'Word', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'reason', label: 'Why', column_type: 'Data', in_list_view: true },
      ],
    })
  }
  const [link] = await sql`select 1 from table_def where name = 'Glossary Link'`
  if (!link) {
    await createTable({
      name: 'Glossary Link',
      module: 'Core',
      kind: 'sub_table',
      system: true,
      columns: [
        // Data, not a Reference: a term must never stand in the way of
        // deleting the Table it describes.
        { column_name: 'link_table', label: 'Table', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'link_column', label: 'Column', column_type: 'Data', in_list_view: true },
      ],
    })
  }
  const [term] = await sql`select 1 from table_def where name = 'Glossary Term'`
  if (!term) {
    await createTable({
      name: 'Glossary Term',
      module: 'Core',
      system: true,
      id_pattern: 'hash',
      title_column: 'term',
      columns: [
        { column_name: 'term', label: 'Term', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'app', label: 'App', column_type: 'Data', read_only: true, in_list_view: true },
        { column_name: 'definition', label: 'Definition', column_type: 'Text', reqd: true },
        { column_name: 'examples', label: 'Examples', column_type: 'Text', description: 'One example per line' },
        { column_name: 'avoid', label: 'Words to avoid', column_type: 'Sub-table', row_table: 'Glossary Avoid Word' },
        { column_name: 'describes', label: 'Describes', column_type: 'Sub-table', row_table: 'Glossary Link' },
        // Kept by the platform: which of the app's terms this is, the app's
        // wording as last shipped, and whether a newer one came while the
        // instance's own wording stood.
        { column_name: 'app_key', label: 'App term', column_type: 'Data', read_only: true, hidden: true },
        { column_name: 'app_wording', label: 'App wording', column_type: 'JSON', read_only: true, hidden: true },
        { column_name: 'app_wording_changed', label: 'App wording changed', column_type: 'Check', read_only: true, hidden: true, default_value: '0' },
      ],
    })
  }
  await sql`
    insert into permission (row_id, ref_table, role, tier, own_rows_only, can_read, can_write, can_create,
      can_delete, can_submit, can_cancel, can_amend)
    values ('glossary-term-everyone-reads', 'Glossary Term', 'All', 'basic', false, true, false, false,
      false, false, false, false)
    on conflict (row_id) do nothing`
}
