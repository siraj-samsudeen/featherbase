import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { deliverAutoEmailReport, runDueAutoEmailReports, toCsv } from '../src/auto-email-report'
import { drainJobs } from '../src/jobs'

// EML-007: a saved Report scheduled as an Auto Email Report is delivered to its
// recipients with the report attached. The scheduler pass respects the cadence.

const DT = 'Aer Srv Widget'
const REPORT = 'Aer Srv Report'
const AER = 'Aer Srv Schedule'
const RECIP = 'aer-boss@x.com'

// Runs at the start of each test, inside its sandbox transaction: clear any
// committed leftovers (rolled back afterwards), then create the DocType,
// documents, Report, and schedule that legacy beforeAll used to set up once.
async function setup(admin: TestClient) {
  await sql`delete from tab_email_sink where subject like ${'Auto Email Report:%'}`
  await sql`delete from tab_email_queue where reference_doctype = 'Report' and reference_name = ${REPORT}`
  await sql`delete from tab_auto_email_report where name = ${AER}`
  await sql`delete from tab_report where name = ${REPORT}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_aer_srv_widget')

  await admin.post('/api/doctype', {
    name: DT,
    autoname: 'prompt',
    fields: [
      { fieldname: 'title', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'qty', fieldtype: 'Int', in_list_view: true },
    ],
  })
  // Two documents to report on. One title has a comma to exercise CSV quoting.
  await admin.post(`/api/resource/${encodeURIComponent(DT)}`, {
    name: 'aer-1',
    title: 'Bolt, hex',
    qty: 10,
  })
  await admin.post(`/api/resource/${encodeURIComponent(DT)}`, {
    name: 'aer-2',
    title: 'Washer',
    qty: 3,
  })

  // A Report Builder report over the DocType.
  await admin.post('/api/save_doc', {
    doctype: 'Report',
    doc: {
      name: REPORT,
      ref_doctype: DT,
      report_type: 'Report Builder',
      config: { columns: ['title', 'qty'], filters: [] },
    },
  })

  await admin.post('/api/save_doc', {
    doctype: 'Auto Email Report',
    doc: {
      name: AER,
      report: REPORT,
      recipients: RECIP,
      file_format: 'CSV',
      frequency: 'Daily',
      enabled: true,
    },
  })
}

// Sandbox clock shim: inside the rolled-back test transaction now() is frozen
// at BEGIN, while the delivery job's run_at is stamped from the wall clock —
// so it never counts as "due" for the claim query. Mark any job whose run_at
// has passed by the wall clock (clock_timestamp) as due by the transaction
// clock, then drain.
async function drainDueJobs() {
  await sql`
    update tab_background_job set run_at = now()
    where status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
  return await drainJobs()
}

describe('EML-007: Auto Email Report', () => {
  test('toCsv quotes fields containing commas and renders header+rows', () => {
    const csv = toCsv(['title', 'qty'], [{ title: 'Bolt, hex', qty: 10 }])
    expect(csv).toBe('title,qty\n"Bolt, hex",10')
  })

  test('delivering runs the report and queues an email with the CSV attached', async ({
    admin,
  }) => {
    await setup(admin)
    const out = await deliverAutoEmailReport(AER)
    expect(out.recipients).toBe(1)
    expect(out.rows).toBe(2)

    // The email is queued referencing the report, addressed to the recipient.
    const [q] = await sql`
      select recipient, subject, attachments from tab_email_queue
      where reference_doctype = 'Report' and reference_name = ${REPORT} order by creation desc limit 1`
    expect(q.recipient).toBe(RECIP)
    expect(String(q.subject)).toContain('Auto Email Report')
    const files = (q.attachments as { files?: { filename: string; content_b64: string }[] }).files ?? []
    expect(files.length).toBe(1)
    expect(files[0].filename).toBe(`${REPORT}.csv`)
    const csv = Buffer.from(files[0].content_b64, 'base64').toString('utf8')
    expect(csv).toContain('title,qty')
    expect(csv).toContain('"Bolt, hex",10')
    expect(csv).toContain('Washer,3')

    // The worker delivers it to the sink with the attachment intact (EML-002/003).
    await drainDueJobs()
    const [sink] = await sql`
      select mail_to, attachment_names, attachment_b64 from tab_email_sink
      where subject like ${'Auto Email Report:%'} order by creation desc limit 1`
    expect(sink.mail_to).toBe(RECIP)
    expect(String(sink.attachment_names)).toContain(`${REPORT}.csv`)
    expect(Buffer.from(sink.attachment_b64 as string, 'base64').toString('utf8')).toContain('Washer,3')

    // last_sent was stamped.
    const [row] = await sql`select last_sent from tab_auto_email_report where name = ${AER}`
    expect(row.last_sent).not.toBeNull()
  })

  test('the scheduler pass skips a report whose Daily cadence has not elapsed', async ({
    admin,
  }) => {
    await setup(admin)
    // Legacy relied on the previous test having just delivered; recreate that
    // state explicitly: deliver once so last_sent is stamped → not due now.
    await deliverAutoEmailReport(AER)
    const delivered = await runDueAutoEmailReports(new Date())
    expect(delivered).not.toContain(AER)

    // Simulate two days passing → due again.
    await sql`update tab_auto_email_report set last_sent = now() - interval '2 days' where name = ${AER}`
    const later = await runDueAutoEmailReports(new Date())
    expect(later).toContain(AER)
  })
})
