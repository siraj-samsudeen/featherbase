// EML-001/002: outbound email. An Email Account holds the sending identity;
// Email Queue holds outgoing messages with delivery status; Email Sink is the
// local dev "mailbox" that captures everything actually delivered (the local
// equivalent of a MailHog-style sink).
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Email Account'`
  if (exists) return

  await createTable({
    name: 'Email Account',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'email_id', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'smtp_host', column_type: 'Data', default_value: 'localhost' },
      { column_name: 'smtp_port', column_type: 'Int', default_value: '1025' },
      { column_name: 'is_default', column_type: 'Check', default_value: '0', in_list_view: true },
    ],
  })

  await createTable({
    name: 'Email Queue',
    module: 'Core',
    columns: [
      { column_name: 'sender', column_type: 'Data', in_list_view: true },
      { column_name: 'recipient', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'subject', column_type: 'Data', in_list_view: true },
      { column_name: 'body', column_type: 'Text' },
      { column_name: 'send_status', column_type: 'Choice', choices: 'queued\nsent\nerror', default_value: 'queued', in_list_view: true },
      { column_name: 'error', column_type: 'Text' },
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table' },
      { column_name: 'reference_name', column_type: 'Data' },
      { column_name: 'attachments', column_type: 'JSON' },
    ],
  })

  // The dev sink: every delivered message lands here, queryable via the API.
  await createTable({
    name: 'Email Sink',
    module: 'Core',
    columns: [
      { column_name: 'mail_from', column_type: 'Data', in_list_view: true },
      { column_name: 'mail_to', column_type: 'Data', in_list_view: true },
      { column_name: 'subject', column_type: 'Data', in_list_view: true },
      { column_name: 'body', column_type: 'Text' },
      { column_name: 'attachment_names', column_type: 'Data' },
      { column_name: 'attachment_b64', column_type: 'Text' },
    ],
  })
}
