import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { deliverAutoEmailReport, runDueAutoEmailReports } from '../src/auto-email-report'
import { createUserWithRole, grantRole } from './fixtures'

// #338: a scheduled report email shows its recipients what the person who
// set the schedule up may see — their row limits, Data Scopes and restricted
// columns — never the whole Table. And it carries every such row, not the
// first 500.
const DT = 'Aeo Order'
const ROLE = 'Aeo Planner'
const REPORT = 'Aeo Mine'
const AER = 'Aeo Weekly'

async function setup(admin: TestClient, createUser: CreateUserFn, columns = ['title']) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'cost', column_type: 'Currency', tier: 'restricted' },
    ],
  })
  const planner = await createUserWithRole(admin, createUser, {
    role: ROLE,
    table: DT,
    tier: 'basic',
    can_read: true,
    can_write: true,
    can_create: true,
    own_rows_only: true,
  })
  await grantRole(admin, { role: ROLE, table: ['Report', 'Auto Email Report'], tier: 'basic', can_read: true, can_write: true, can_create: true })
  await admin.post('/api/save_row', { table: DT, row: { title: 'Someone else’s order', cost: 111 } })
  await planner.post('/api/save_row', { table: DT, row: { title: 'Planner order' } })
  await planner.post('/api/save_row', {
    table: 'Report',
    row: { row_id: REPORT, ref_table: DT, report_type: 'Report Builder', config: { columns, filters: [] } },
  })
  await planner.post('/api/save_row', {
    table: 'Auto Email Report',
    row: { row_id: AER, report: REPORT, recipients: 'team@store.test', file_format: 'CSV', frequency: 'Daily', enabled: true },
  })
  return planner
}

async function sentCsv(): Promise<string[]> {
  const queued = await sql`
    select attachments from email_queue where ref_table = 'Report' and reference_name = ${REPORT}`
  return queued.map((q) => {
    const files = (q.attachments as { files: { content_b64: string }[] }).files
    return Buffer.from(files[0].content_b64, 'base64').toString('utf8')
  })
}

describe('#338: scheduled report emails run as the person who set them up', () => {
  test('a scheduled send carries only the rows its owner may see', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    expect(await runDueAutoEmailReports(new Date())).toContain(AER)
    const [csv] = await sentCsv()
    expect(csv).toContain('Planner order')
    expect(csv).not.toContain('Someone else')
  })

  test('sending now from Admin shows recipients the same rows as the schedule', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await admin.post('/api/run_auto_email_report', { row_id: AER })
    const [csv] = await sentCsv()
    expect(csv).toContain('Planner order')
    expect(csv).not.toContain('Someone else')
  })

  test('a report asking for a column its owner cannot see is not sent', async ({ admin, createUser }) => {
    await setup(admin, createUser, ['title', 'cost'])
    await expect(deliverAutoEmailReport(AER)).rejects.toMatchObject({ type: 'ValidationError' })
    expect(await sentCsv()).toHaveLength(0)
  })

  test('a schedule whose owner is disabled sends nothing, and the others still go', async ({ admin, createUser }) => {
    const planner = await setup(admin, createUser)
    await sql`update person set enabled = false where row_id = ${planner.user}`
    await admin.post('/api/save_row', {
      table: 'Auto Email Report',
      row: { row_id: 'Aeo Admin Daily', report: REPORT, recipients: 'boss@store.test', file_format: 'CSV', frequency: 'Daily', enabled: true },
    })
    await expect(runDueAutoEmailReports(new Date())).rejects.toThrow(/Aeo Weekly/)
    const queued = await sql`select recipient from email_queue where ref_table = 'Report' and reference_name = ${REPORT}`
    expect(queued.map((q) => q.recipient)).toEqual(['boss@store.test'])
  })

  test('every row the owner may see is attached, past the first 500', async ({ admin, createUser }) => {
    const planner = await setup(admin, createUser)
    await sql.unsafe(
      `insert into featherbase.aeo_order (row_id, title, created_by, updated_by, status)
       select 'bulk-' || n, 'Bulk ' || n, '${planner.user}', '${planner.user}', 'draft' from generate_series(1, 600) n`,
    )
    const out = await deliverAutoEmailReport(AER)
    expect(out.rows).toBe(601)
    const [csv] = await sentCsv()
    expect(csv.split('\n')).toHaveLength(602)
    const [mail] = await sql`select body from email_queue where ref_table = 'Report' and reference_name = ${REPORT}`
    expect(mail.body).toContain('(601 rows)')
  })

  test('only the person who set a schedule up, or a System Manager, may change its report or recipients', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const colleague = await createUser({ roles: [ROLE] })
    const url = `/api/table/${encodeURIComponent('Auto Email Report')}/${encodeURIComponent(AER)}`
    const cur = await colleague.get<Record<string, any>>(url)
    const res = await colleague.fetch(url, {
      method: 'PATCH',
      body: JSON.stringify({ updated_at: cur.updated_at, recipients: 'outsider@elsewhere.test' }),
    })
    expect(res.status).toBe(403)
    // A change to anything else is theirs to make.
    const renamed = await colleague.fetch(url, {
      method: 'PATCH',
      body: JSON.stringify({ updated_at: cur.updated_at, frequency: 'Weekly' }),
    })
    expect(renamed.status).toBe(200)
    const now = await admin.get<Record<string, any>>(url)
    await admin.fetch(url, { method: 'PATCH', body: JSON.stringify({ updated_at: now.updated_at, recipients: 'lead@store.test' }) })
    expect((await admin.get<Record<string, any>>(url)).recipients).toBe('lead@store.test')
  })
})

describe('#611: a report a schedule sends changes only with its scheduler', () => {
  const reportUrl = `/api/table/Report/${encodeURIComponent(REPORT)}`
  const widen = async (client: TestClient) => {
    const cur = await currentReport(client)
    return client.fetch(reportUrl, {
      method: 'PATCH',
      body: JSON.stringify({ updated_at: cur.updated_at, config: { columns: ['title', 'cost'], filters: [] } }),
    })
  }
  const currentReport = (client: TestClient) => client.get<Record<string, any>>(reportUrl)

  test('a colleague who may edit reports cannot change one a schedule sends', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const colleague = await createUser({ roles: [ROLE] })
    expect((await widen(colleague)).status).toBe(403)
    expect((await admin.get<Record<string, any>>(reportUrl)).config).toEqual({ columns: ['title'], filters: [] })
  })

  test('the person who set up every schedule that sends it, or a System Manager, may change it', async ({ admin, createUser }) => {
    const planner = await setup(admin, createUser)
    expect((await widen(planner)).status).toBe(200)
    expect((await widen(admin)).status).toBe(200)
  })

  test('once a second person schedules the report, neither may change it alone', async ({ admin, createUser }) => {
    const planner = await setup(admin, createUser)
    const colleague = await createUser({ roles: [ROLE] })
    await colleague.post('/api/save_row', {
      table: 'Auto Email Report',
      row: { row_id: 'Aeo Colleague', report: REPORT, recipients: 'me@store.test', file_format: 'CSV', frequency: 'Daily', enabled: true },
    })
    expect((await widen(planner)).status).toBe(403)
    expect((await widen(colleague)).status).toBe(403)
  })

  test('a report no schedule sends stays open to anyone who may edit reports', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const colleague = await createUser({ roles: [ROLE] })
    await sql`delete from auto_email_report where row_id = ${AER}`
    expect((await widen(colleague)).status).toBe(200)
  })
})
