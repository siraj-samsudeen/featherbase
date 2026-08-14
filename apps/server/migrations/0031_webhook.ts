// PLAT-005: Webhooks — configure an HTTP callback fired on a DocType's
// lifecycle events, with a shared secret for HMAC signing.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Webhook'`
  if (exists) return
  await createTable({
    name: 'Webhook',
    module: 'Core',
    columns: [
      { column_name: 'webhook_table', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'webhook_event', column_type: 'Choice', choices: 'after_insert\non_update\non_submit\non_cancel', reqd: true, in_list_view: true },
      { column_name: 'request_url', column_type: 'Data', reqd: true },
      { column_name: 'webhook_secret', column_type: 'Data' },
      { column_name: 'enabled', column_type: 'Check', default_value: '1', in_list_view: true },
    ],
  })
}
