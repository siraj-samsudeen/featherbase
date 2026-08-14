// WEB-001: Web Pages — published documents that render as public,
// server-rendered pages reachable at /web/<route> without a session.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Web Page'`
  if (exists) return
  await createTable({
    name: 'Web Page',
    module: 'Website',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'title', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'route', column_type: 'Data', reqd: true, unique: true, in_list_view: true },
      { column_name: 'content', column_type: 'Long Text' },
      { column_name: 'published', column_type: 'Check', default_value: '0', in_list_view: true },
    ],
  })
}
