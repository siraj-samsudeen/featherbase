// I18N-001: translation catalog. Each row maps a source string to its
// translation in a target language. t() looks these up at render time.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Translation'`
  if (exists) return
  await createTable({
    name: 'Translation',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'language', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'source_text', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'translated_text', column_type: 'Text', reqd: true, in_list_view: true },
    ],
  })
  // Uniqueness per (language, source) so a catalog lookup is unambiguous.
  await sql.unsafe(
    'create unique index if not exists translation_lang_src on translation (language, source_text)',
  )
}
