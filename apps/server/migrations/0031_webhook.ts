// PLAT-005: Webhooks — configure an HTTP callback fired on a DocType's
// lifecycle events, with a shared secret for HMAC signing.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Webhook'`
  if (exists) return
  await createDocType({
    name: 'Webhook',
    module: 'Core',
    fields: [
      { fieldname: 'webhook_doctype', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      { fieldname: 'webhook_event', fieldtype: 'Select', options: 'after_insert\non_update\non_submit\non_cancel', reqd: true, in_list_view: true },
      { fieldname: 'request_url', fieldtype: 'Data', reqd: true },
      { fieldname: 'webhook_secret', fieldtype: 'Data' },
      { fieldname: 'enabled', fieldtype: 'Check', default_value: '1', in_list_view: true },
    ],
  })
}
