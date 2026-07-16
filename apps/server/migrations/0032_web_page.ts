// WEB-001: Web Pages — published documents that render as public,
// server-rendered pages reachable at /web/<route> without a session.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Web Page'`
  if (exists) return
  await createDocType({
    name: 'Web Page',
    module: 'Website',
    autoname: 'prompt',
    fields: [
      { fieldname: 'title', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'route', fieldtype: 'Data', reqd: true, unique: true, in_list_view: true },
      { fieldname: 'content', fieldtype: 'Long Text' },
      { fieldname: 'published', fieldtype: 'Check', default_value: '0', in_list_view: true },
    ],
  })
}
