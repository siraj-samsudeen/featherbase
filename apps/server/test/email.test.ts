import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { drainJobs, loadJobs } from '../src/jobs'
import { queueEmail, renderTemplate, sendTestEmail } from '../src/email'

// EML-001: a configured account sends a test mail captured by the sink.
// EML-002: a queued email transitions queued -> sent and the sink receives
// exactly one copy.

const ACCOUNT = 'Eml Test Account'

async function cleanup() {
  await sql`delete from tab_email_sink`
  await sql`delete from tab_email_queue`
  await sql`delete from tab_email_account where name = ${ACCOUNT}`
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
})
