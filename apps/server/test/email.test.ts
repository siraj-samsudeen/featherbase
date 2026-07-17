import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { drainJobs, loadJobs } from '../src/jobs'
import { queueEmail, renderTemplate, sendTestEmail } from '../src/email'

const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse') as {
  PDFParse: new (opts: { data: Uint8Array }) => { getText: () => Promise<{ text: string }> }
}

// EML-001: a configured account sends a test mail captured by the sink.
// EML-002: a queued email transitions queued -> sent and the sink receives
// exactly one copy.

const ACCOUNT = 'Eml Test Account'

async function cleanup() {
  await sql`delete from tab_email_sink`
  await sql`delete from tab_email_queue`
  await sql`delete from tab_email_account where name = ${ACCOUNT}`
  await sql`delete from tab_docfield where parent in ('Eml Ref', 'Eml Pdf')`
  await sql`delete from tab_doctype where name in ('Eml Ref', 'Eml Pdf')`
  await sql.unsafe('drop table if exists tab_eml_ref, tab_eml_pdf')
}

beforeAll(async () => {
  await loadJobs()
  await cleanup()
  await sql`
    insert into tab_email_account ${sql({
      name: ACCOUNT,
      owner: 'Administrator',
      modified_by: 'Administrator',
      email_id: 'sender@frappe.test',
      is_default: true,
    })}`
})

afterAll(cleanup)

describe('EML-001: send test email', () => {
  it('delivers a test mail to the sink from the default account', async () => {
    await sendTestEmail('target@x.com')
    const rows = await sql`select mail_from, mail_to, subject from tab_email_sink`
    expect(rows).toHaveLength(1)
    expect(rows[0].mail_from).toBe('sender@frappe.test')
    expect(rows[0].mail_to).toBe('target@x.com')
    expect(rows[0].subject).toContain('Test email')
  })
})

describe('EML-002: queued email delivery', () => {
  it('transitions queued -> sent and delivers exactly one copy', async () => {
    await sql`delete from tab_email_sink`
    const name = await queueEmail({ to: 'q@x.com', subject: 'Queued Subject', body: 'hi' })

    // Initially queued, not yet delivered.
    const [before] = await sql`select status from tab_email_queue where name = ${name}`
    expect(before.status).toBe('queued')
    expect(await sql`select count(*)::int as c from tab_email_sink`).toEqual([{ c: 0 }])

    await drainJobs()

    const [after] = await sql`select status from tab_email_queue where name = ${name}`
    expect(after.status).toBe('sent')

    const sink = await sql`select mail_to, subject from tab_email_sink where subject = 'Queued Subject'`
    expect(sink).toHaveLength(1)
    expect(sink[0].mail_to).toBe('q@x.com')
  })

  it('re-draining does not send a second copy (idempotent claim)', async () => {
    const before = (await sql`select count(*)::int as c from tab_email_sink`)[0].c as number
    await drainJobs() // nothing queued now
    const after = (await sql`select count(*)::int as c from tab_email_sink`)[0].c as number
    expect(after).toBe(before)
  })
})

describe('EML-005: template rendering', () => {
  it('renders {{ doc.field }} against a document', () => {
    expect(renderTemplate('Hi {{ doc.subject }}!', { subject: 'Report' })).toBe('Hi Report!')
    expect(renderTemplate('{{ doc.missing }}x', {})).toBe('x')
  })

  it('a queued template email is rendered with the actual field value in the sink', async () => {
    await sql`delete from tab_email_sink`
    await sql`delete from tab_docfield where parent = 'Eml Ref'`
    await sql`delete from tab_doctype where name = 'Eml Ref'`
    await sql.unsafe('drop table if exists tab_eml_ref')
    const { createDocType } = await import('../src/doctype-engine')
    await createDocType({
      name: 'Eml Ref',
      autoname: 'prompt',
      fields: [{ fieldname: 'subject', fieldtype: 'Data' }],
    })
    const { saveDoc } = await import('../src/document')
    await saveDoc('Eml Ref', { name: 'ref-1', subject: 'Quarterly Numbers' }, 'Administrator')

    await queueEmail({
      to: 'r@x.com',
      subject: 'Re: {{ doc.subject }}',
      body: 'See {{ doc.subject }} attached.',
      reference_doctype: 'Eml Ref',
      reference_name: 'ref-1',
      render: true,
    })
    await drainJobs()

    const [sink] = await sql`select subject, body from tab_email_sink order by creation desc limit 1`
    expect(sink.subject).toBe('Re: Quarterly Numbers')
    expect(sink.body).toContain('See Quarterly Numbers attached')
  }, 20_000)
})

describe('EML-003: PDF attachment', () => {
  it('a queued email with attach_pdf delivers a PDF whose text matches the document', async () => {
    await sql`delete from tab_email_sink`
    await sql`delete from tab_docfield where parent = 'Eml Pdf'`
    await sql`delete from tab_doctype where name = 'Eml Pdf'`
    await sql.unsafe('drop table if exists tab_eml_pdf')
    const { createDocType } = await import('../src/doctype-engine')
    await createDocType({
      name: 'Eml Pdf',
      autoname: 'prompt',
      fields: [{ fieldname: 'customer', fieldtype: 'Data' }],
    })
    const { saveDoc } = await import('../src/document')
    await saveDoc('Eml Pdf', { name: 'inv-1', customer: 'Wonka Industries' }, 'Administrator')

    await queueEmail({
      to: 'billing@x.com',
      subject: 'Invoice',
      body: 'Attached.',
      reference_doctype: 'Eml Pdf',
      reference_name: 'inv-1',
      attach_pdf: true,
    })
    await drainJobs()

    const [sink] = await sql`
      select attachment_names, attachment_b64 from tab_email_sink order by creation desc limit 1`
    expect(sink.attachment_names).toBe('inv-1.pdf')
    expect(sink.attachment_b64).toBeTruthy()

    const pdf = Buffer.from(sink.attachment_b64 as string, 'base64')
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const parser = new PDFParse({ data: new Uint8Array(pdf) })
    const text = (await parser.getText()).text
    expect(text).toContain('Wonka Industries')

    await sql`delete from tab_docfield where parent = 'Eml Pdf'`
    await sql`delete from tab_doctype where name = 'Eml Pdf'`
    await sql.unsafe('drop table if exists tab_eml_pdf')
  }, 30_000)
})
