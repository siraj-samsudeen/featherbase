import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { tableRelation } from '../src/table-engine'
import { deliverAutoEmailReport, runDueAutoEmailReports, toCsv } from '../src/auto-email-report'
import { drainJobs, enqueue } from '../src/jobs'
import { expectApiError, grantRole } from './fixtures'

// EML-007: a saved Report scheduled as an Auto Email Report is delivered to its
// recipients with the report attached. The scheduler pass respects the cadence.

const DT = 'Aer Srv Widget'
const REPORT = 'Aer Srv Report'
const AER = 'Aer Srv Schedule'
const RECIP = 'aer-boss@x.com'

// Runs at the start of each test, inside its sandbox transaction: clear any
// committed leftovers (rolled back afterwards), then create the Table,
// documents, Report, and schedule that legacy beforeAll used to set up once.
async function setup(admin: TestClient) {
  await sql`delete from email_sink where subject like ${'Auto Email Report:%'}`
  await sql`delete from email_queue where ref_table = 'Report' and reference_name = ${REPORT}`
  await sql`delete from auto_email_report where row_id = ${AER}`
  await sql`delete from report where row_id = ${REPORT}`
  await sql`delete from column_def where parent = ${DT}`
  await sql`delete from table_def where name = ${DT}`
  await sql.unsafe('drop table if exists aer_srv_widget')

  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', in_list_view: true },
    ],
  })
  // Two documents to report on. One title has a comma to exercise CSV quoting.
  await admin.post(`/api/table/${encodeURIComponent(DT)}`, {
    row_id: 'aer-1',
    title: 'Bolt, hex',
    qty: 10,
  })
  await admin.post(`/api/table/${encodeURIComponent(DT)}`, {
    row_id: 'aer-2',
    title: 'Washer',
    qty: 3,
  })

  // A Report Builder report over the Table.
  await admin.post('/api/save_row', {
    table: 'Report',
    row: {
      row_id: REPORT,
      ref_table: DT,
      report_type: 'Report Builder',
      config: { columns: ['title', 'qty'], filters: [] },
    },
  })

  await admin.post('/api/save_row', {
    table: 'Auto Email Report',
    row: {
      row_id: AER,
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
    update background_job set run_at = now()
    where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
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
    const out = await admin.post<{ recipients: number; rows: number }>('/api/run_auto_email_report', { row_id: AER })
    expect(out.recipients).toBe(1)
    expect(out.rows).toBe(2)

    // The email is queued referencing the report, addressed to the recipient.
    const [q] = await sql`
      select recipient, subject, attachments from email_queue
      where ref_table = 'Report' and reference_name = ${REPORT} order by created_at desc limit 1`
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
      select mail_to, attachment_names, attachment_b64 from email_sink
      where subject like ${'Auto Email Report:%'} order by created_at desc limit 1`
    expect(sink.mail_to).toBe(RECIP)
    expect(String(sink.attachment_names)).toContain(`${REPORT}.csv`)
    expect(Buffer.from(sink.attachment_b64 as string, 'base64').toString('utf8')).toContain('Washer,3')

    // last_sent was stamped.
    const [row] = await sql`select last_sent from auto_email_report where row_id = ${AER}`
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
    await sql`update auto_email_report set last_sent = now() - interval '2 days' where row_id = ${AER}`
    const later = await runDueAutoEmailReports(new Date())
    expect(later).toContain(AER)
  })

  test('only a System Manager may run a report now, and the schedule must be named', async ({ admin, createUser }) => {
    await setup(admin)
    await expectApiError(admin.post('/api/run_auto_email_report', {}), {
      status: 417, type: 'ValidationError', message: expect.stringContaining('Expected { row_id }'),
    })
    const clerk = await createUser({ email: 'aer-clerk@x.com', roles: [] })
    await expectApiError(clerk.post('/api/run_auto_email_report', { row_id: AER }), { status: 403 })
    expect(await sql`select 1 from email_queue where ref_table = 'Report' and reference_name = ${REPORT}`).toHaveLength(0)
  })

  test('the auto_email_reports job delivers every report that is due', async ({ admin }) => {
    await setup(admin)
    await enqueue('auto_email_reports', {})
    await drainDueJobs()
    const queued = await sql`select recipient from email_queue where ref_table = 'Report' and reference_name = ${REPORT}`
    expect(queued.map((q) => q.recipient)).toEqual([RECIP])
    const [row] = await sql`select last_sent from auto_email_report where row_id = ${AER}`
    expect(row.last_sent).not.toBeNull()
  })

  test('a weekly report is not sent again until a week has passed', async ({ admin }) => {
    await setup(admin)
    await sql`update auto_email_report set frequency = 'Weekly' where row_id = ${AER}`
    expect(await runDueAutoEmailReports(new Date())).toContain(AER) // never sent: due now
    expect(await runDueAutoEmailReports(new Date())).not.toContain(AER) // just sent
    await sql`update auto_email_report set last_sent = now() - interval '3 days' where row_id = ${AER}`
    expect(await runDueAutoEmailReports(new Date())).not.toContain(AER)
    await sql`update auto_email_report set last_sent = now() - interval '8 days' where row_id = ${AER}`
    expect(await runDueAutoEmailReports(new Date())).toContain(AER)
  })

  test('each recipient gets their own email, however the list is separated', async ({ admin }) => {
    await setup(admin)
    await sql`update auto_email_report set recipients = ${'a@x.com, b@x.com;c@x.com d@x.com'} where row_id = ${AER}`
    const out = await deliverAutoEmailReport(AER)
    expect(out.recipients).toBe(4)
    const queued = await sql`select recipient from email_queue where ref_table = 'Report' and reference_name = ${REPORT} order by recipient`
    expect(queued.map((q) => q.recipient)).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'])
  })

  test('a disabled schedule is never sent, and one with no recipients is refused', async ({ admin }) => {
    await setup(admin)
    await sql`update auto_email_report set enabled = false where row_id = ${AER}`
    expect(await runDueAutoEmailReports(new Date())).not.toContain(AER)
    await expect(deliverAutoEmailReport(AER)).rejects.toMatchObject({ type: 'ValidationError' })
    await sql`update auto_email_report set enabled = true, recipients = '' where row_id = ${AER}`
    await expect(deliverAutoEmailReport(AER)).rejects.toMatchObject({ type: 'ValidationError' })
    const queued = await sql`select 1 from email_queue where ref_table = 'Report' and reference_name = ${REPORT}`
    expect(queued).toHaveLength(0)
  })

  test('the attachment can be a web page table instead of a CSV file', async ({ admin }) => {
    await setup(admin)
    await sql`update auto_email_report set file_format = 'HTML' where row_id = ${AER}`
    await deliverAutoEmailReport(AER)
    const [q] = await sql`select attachments from email_queue where ref_table = 'Report' and reference_name = ${REPORT}`
    const files = (q.attachments as { files?: { filename: string; content_b64: string }[] }).files ?? []
    expect(files[0].filename).toBe(`${REPORT}.html`)
    expect(Buffer.from(files[0].content_b64, 'base64').toString('utf8')).toContain('<td>Washer</td>')
  })
})

// #338: a scheduled send runs with the access of the person who set it up,
// never as Administrator, and stops once that person is disabled.
describe('A scheduled report is sent with its setter\'s access', () => {
  async function setterWorld(admin: TestClient, createUser: (o?: { email?: string; roles?: string[] }) => Promise<TestClient>) {
    await setup(admin)
    await grantRole(admin, { role: 'Aer Setter', table: DT, can_read: true, can_create: true, can_write: true, own_rows_only: true })
    await grantRole(admin, { role: 'Aer Setter', table: ['Report', 'Auto Email Report'], can_read: true, can_create: true, can_write: true })
    const setter = await createUser({ email: 'aer-setter@x.com', roles: ['Aer Setter'] })
    await setter.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'aer-mine', title: 'Mine only', qty: 1 })
    await setter.post('/api/save_row', {
      table: 'Auto Email Report',
      row: { row_id: 'Aer Setter Schedule', report: REPORT, recipients: 'aer-team@x.com', file_format: 'CSV', frequency: 'Daily', enabled: true },
    })
    await sql`update auto_email_report set enabled = false where row_id = ${AER}`
    return setter
  }
  const sentCsv = async () => {
    const rows = await sql`select attachments from email_queue where recipient = 'aer-team@x.com'`
    return rows.map((q) => Buffer.from((q.attachments as { files: { content_b64: string }[] }).files[0].content_b64, 'base64').toString('utf8'))
  }

  test('the scheduled send holds only the rows the setter can see', async ({ admin, createUser }) => {
    await setterWorld(admin, createUser)
    expect(await runDueAutoEmailReports(new Date())).toEqual(['Aer Setter Schedule'])
    const [csv] = await sentCsv()
    expect(csv).toContain('Mine only')
    expect(csv).not.toContain('Washer')
  })

  test('a disabled setter\'s schedule sends nothing, and the other schedules still go', async ({ admin, createUser }) => {
    const setter = await setterWorld(admin, createUser)
    await sql`update auto_email_report set enabled = true where row_id = ${AER}`
    await sql`update person set enabled = false where row_id = ${setter.user}`
    expect(await runDueAutoEmailReports(new Date())).toEqual([AER])
    expect(await sentCsv()).toEqual([])
    const [row] = await sql`select last_sent from auto_email_report where row_id = 'Aer Setter Schedule'`
    expect(row.last_sent).toBeNull()
  })
})

test('a schedule whose setter can no longer read the report is skipped, and the others still go', async ({ admin, createUser }) => {
  await setup(admin)
  await grantRole(admin, { role: 'Aer Lapsed', table: ['Report', 'Auto Email Report'], can_read: true, can_create: true, can_write: true })
  const setter = await createUser({ email: 'aer-lapsed@x.com', roles: ['Aer Lapsed'] })
  await setter.post('/api/save_row', {
    table: 'Auto Email Report',
    row: { row_id: 'Aer Lapsed Schedule', report: REPORT, recipients: 'aer-lapsed-team@x.com', frequency: 'Daily', enabled: true },
  })
  // The setter has no read on the report's Table at all.
  expect(await runDueAutoEmailReports(new Date())).toEqual([AER])
  expect(await sql`select 1 from email_queue where recipient = 'aer-lapsed-team@x.com'`).toHaveLength(0)
})

// #338: the attachment carries every row of the report, not the first 500.
test('a report longer than one page is sent whole', async ({ admin }) => {
  await setup(admin)
  await sql`insert into ${sql(await tableRelation(DT))} (row_id, title, qty, created_by, updated_by)
    select 'bulk-' || n, 'Bulk ' || n, n, 'Administrator', 'Administrator' from generate_series(1, 600) n`
  const out = await deliverAutoEmailReport(AER)
  expect(out.rows).toBe(602)
  const [q] = await sql`select body, attachments from email_queue where ref_table = 'Report' and reference_name = ${REPORT}`
  expect(String(q.body)).toContain('(602 rows)')
  const csv = Buffer.from((q.attachments as { files: { content_b64: string }[] }).files[0].content_b64, 'base64').toString('utf8')
  expect(csv.split('\n')).toHaveLength(603)
})
