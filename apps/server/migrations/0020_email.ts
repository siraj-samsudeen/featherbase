// EML-001/002: outbound email. An Email Account holds the sending identity;
// Email Queue holds outgoing messages with delivery status; Email Sink is the
// local dev "mailbox" that captures everything actually delivered (the local
// equivalent of a MailHog-style sink).
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Email Account'`
  if (exists) return

  await createDocType({
    name: 'Email Account',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'email_id', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'smtp_host', fieldtype: 'Data', default_value: 'localhost' },
      { fieldname: 'smtp_port', fieldtype: 'Int', default_value: '1025' },
      { fieldname: 'is_default', fieldtype: 'Check', default_value: '0', in_list_view: true },
    ],
  })

  await createDocType({
    name: 'Email Queue',
    module: 'Core',
    fields: [
      { fieldname: 'sender', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'recipient', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'subject', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'body', fieldtype: 'Text' },
      { fieldname: 'status', fieldtype: 'Select', options: 'queued\nsent\nerror', default_value: 'queued', in_list_view: true },
      { fieldname: 'error', fieldtype: 'Text' },
      { fieldname: 'reference_doctype', fieldtype: 'Link', options: 'DocType' },
      { fieldname: 'reference_name', fieldtype: 'Data' },
      { fieldname: 'attachments', fieldtype: 'JSON' },
    ],
  })

  // The dev sink: every delivered message lands here, queryable via the API.
  await createDocType({
    name: 'Email Sink',
    module: 'Core',
    fields: [
      { fieldname: 'mail_from', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'mail_to', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'subject', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'body', fieldtype: 'Text' },
      { fieldname: 'attachment_names', fieldtype: 'Data' },
      { fieldname: 'attachment_b64', fieldtype: 'Text' },
    ],
  })
}
