// I18N-001: translation catalog. Each row maps a source string to its
// translation in a target language. t() looks these up at render time.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Translation'`
  if (exists) return
  await createDocType({
    name: 'Translation',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'language', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'source_text', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'translated_text', fieldtype: 'Text', reqd: true, in_list_view: true },
    ],
  })
  // Uniqueness per (language, source) so a catalog lookup is unambiguous.
  await sql.unsafe(
    'create unique index if not exists tab_translation_lang_src on tab_translation (language, source_text)',
  )
}
