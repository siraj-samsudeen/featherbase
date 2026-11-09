import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { expectRefused, makeTable, patchDoc } from './fixtures'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { quoteRelation, tableRelation } from '../src/table-engine'
import { enqueue, loadJobs, drainJobs } from '../src/jobs'

// #1022: the submit lifecycle is `submission_status`, so `status` is a
// business column like any other. Holding the lifecycle's own words must mean
// nothing to the platform.
const TABLE = 'Sst Site'
const relationOf = async (name: string) => quoteRelation(await tableRelation(name))
const site = (admin: TestClient, is_submittable = false) => makeTable(admin, {
  name: TABLE, is_submittable, columns: ['title', 'status:Data'],
})

describe('#1022 a business column called status', () => {
  test('holding "cancelled" locks nothing: the row saves, deletes and stays in draft', async ({ admin }) => {
    const t = await site(admin)
    const row = await admin.post<Record<string, unknown>>(t.url, { row_id: 'a', title: 'Riverside', status: 'cancelled' })
    expect(row).toMatchObject({ status: 'cancelled', submission_status: 'draft' })
    expect(await admin.get(`${t.rowUrl('a')}:capabilities`)).toMatchObject({ write: true, delete: true })
    const saved = await patchDoc<Record<string, unknown>>(admin, t.rowUrl('a'), { updated_at: row.updated_at, title: 'Riverside 2' })
    expect(saved).toMatchObject({ title: 'Riverside 2', status: 'cancelled' })
    await sql`delete from version where ref_table = ${TABLE}`
    await admin.delete(t.rowUrl('a'))
  })

  test('submitting locks on the lifecycle and leaves the business status alone', async ({ admin }) => {
    const t = await site(admin, true)
    await admin.post(t.url, { row_id: 'b', title: 'Kochi', status: 'submitted' })
    expect(await admin.get(`${t.rowUrl('b')}:capabilities`)).toMatchObject({ submit: true, write: true })
    const submitted = await admin.post<Record<string, unknown>>(`${t.rowUrl('b')}:submit`)
    expect(submitted).toMatchObject({ status: 'submitted', submission_status: 'submitted' })
    await expectRefused(patchDoc(admin, t.rowUrl('b'), { updated_at: submitted.updated_at, title: 'late' }), 417)
  })

  test('a save cannot set the lifecycle', async ({ admin }) => {
    const t = await site(admin)
    const row = await admin.post<Record<string, unknown>>(t.url, { row_id: 'c', title: 'x', submission_status: 'submitted' })
    expect(row.submission_status).toBe('draft')
  })

  test('a workflow moves the lifecycle and never overwrites the business status', async ({ admin }) => {
    await site(admin)
    await saveDoc('Workflow', {
      row_id: 'Sst Flow', ref_table: TABLE, is_active: true,
      states: [{ state: 'Open', target_status: 'draft' }, { state: 'Done', target_status: 'submitted' }],
      transitions: [{ state: 'Open', action: 'Finish', next_state: 'Done', allowed: 'All' }],
    })
    await admin.post(`/api/table/${encodeURIComponent(TABLE)}`, { row_id: 'd', title: 'x', status: 'cancelled' })
    const after = await admin.post(`/api/table/${encodeURIComponent(TABLE)}/d:apply_workflow_action`, { action: 'Finish' })
    expect(after).toMatchObject({ status: 'cancelled', submission_status: 'submitted', workflow_state: 'Done' })
  })

  test('the name submission_status is refused', async ({ admin }) => {
    await expectRefused(makeTable(admin, { name: 'Sst Reserved', columns: ['submission_status'] }), 417)
  })
})

describe('#1022 SLA escalation', () => {
  test('a Table with no workflow reads fulfilled states from its own status column', async ({ admin }) => {
    await loadJobs()
    await makeTable(admin, {
      name: 'Sst Ticket',
      columns: ['status:Data', 'priority:Data',
        { column_name: 'resolution_by', column_type: 'Datetime', read_only: true },
        { column_name: 'sla_status', column_type: 'Data', read_only: true }],
    })
    await saveDoc('Service Level Agreement', {
      row_id: 'Sst SLA', ref_table: 'Sst Ticket', enabled: true, priority_field: 'priority', fulfilled_states: 'Resolved',
      priorities: [{ priority: 'High', response_hours: 1, resolution_hours: 4 }],
    })
    const open = await saveDoc('Sst Ticket', { status: 'Open', priority: 'High' }, 'Administrator')
    const done = await saveDoc('Sst Ticket', { status: 'Resolved', priority: 'High' }, 'Administrator')
    await sql`update featherbase.sst_ticket set resolution_by = now() - interval '1 hour'`
    await enqueue('check_sla', {})
    await sql`update background_job set run_at = now() where job_status = 'queued'`
    await drainJobs()
    const sla = async (id: unknown) => (await sql`select sla_status from featherbase.sst_ticket where row_id = ${String(id)}`)[0].sla_status
    expect(await sla(open.row_id)).toBe('Overdue')
    expect(await sla(done.row_id)).toBe('On Track')
  })
})

describe('#1022 migration 0151', () => {
  const up = async () => (await import('../migrations/0152_submission_status')).up()
  const columns = async (table: string) => (await sql`
    select column_name from information_schema.columns
    where table_name = ${table} and column_name in ('status', 'submission_status') order by 1`).map((c) => c.column_name)

  test('renames a Table and its sub-table from before it, keeping rows, and reruns cleanly', async ({ admin }) => {
    await makeTable(admin, { name: 'Sst Line', kind: 'sub_table', columns: ['item'] })
    const parent = await makeTable(admin, { name: 'Sst Old', columns: ['title', { column_name: 'lines', column_type: 'Sub-table', row_table: 'Sst Line' }] })
    await admin.post(parent.url, { row_id: 'e', title: 'x', lines: [{ item: 'bolt' }] })
    await sql.unsafe(`update ${await relationOf('Sst Old')} set submission_status = 'cancelled'`)
    for (const name of ['Sst Old', 'Sst Line']) await sql.unsafe(`alter table ${await relationOf(name)} rename submission_status to status`)
    await up()
    await up()
    expect(await columns('sst_old')).toEqual(['submission_status'])
    expect(await columns('sst_line')).toEqual(['submission_status'])
    expect(await admin.get(parent.rowUrl('e'))).toMatchObject({ submission_status: 'cancelled', lines: [{ item: 'bolt', submission_status: 'draft' }] })
  })

  test('leaves a declared business status beside the lifecycle on a rerun', async ({ admin }) => {
    await site(admin)
    await up()
    expect(await columns('sst_site')).toEqual(['status', 'submission_status'])
  })

  test('leaves the platform\'s person_match, whose status is its own', async () => {
    await up()
    expect(await columns('person_match')).toEqual(['status'])
  })

  test('nothing is left with a lifecycle column under the old name', async () => {
    const left = await sql`select table_schema, table_name from information_schema.columns
      where column_name = 'status' and column_default like '''draft''%'`
    expect(left).toEqual([])
  })

  const refused = async (name: string, column: string, alter: string) => {
    await sql.unsafe(`alter table ${await relationOf(name)} ${alter}`)
    await expect(up()).rejects.toThrow(new RegExp(`${name}\\.${column}.*Nothing was changed`))
  }

  test('refuses a builder\'s column already called submission_status, changing nothing', async ({ admin }) => {
    await makeTable(admin, { name: 'Sst Clash', columns: ['title'] })
    await sql`insert into column_def (parent, position, column_name, label, column_type)
      values ('Sst Clash', 9, 'submission_status', 'x', 'Data')`
    await sql.unsafe(`alter table ${await relationOf('Sst Clash')} rename submission_status to status`)
    await sql.unsafe(`alter table ${await relationOf('Sst Clash')} add column submission_status varchar(140)`)
    await expect(up()).rejects.toThrow(/Sst Clash\.submission_status.*Nothing was changed/)
    expect(await columns('sst_clash')).toEqual(['status', 'submission_status'])
  })

  test('refuses an undeclared status beside the lifecycle', async ({ admin }) => {
    await makeTable(admin, { name: 'Sst Both', columns: ['title'] })
    await refused('Sst Both', 'status', 'add column status text')
  })

  test('refuses a status that is not the platform\'s: another type or default', async ({ admin }) => {
    await makeTable(admin, { name: 'Sst Other', columns: ['title'] })
    await refused('Sst Other', 'status', `drop column submission_status, add column status text default 'open'`)
    expect(await columns('sst_other')).toEqual(['status'])
  })

  test('refuses a status holding anything but the lifecycle', async ({ admin }) => {
    const t = await makeTable(admin, { name: 'Sst Stray', columns: ['title'] })
    await admin.post(t.url, { row_id: 'f', title: 'x' })
    await sql.unsafe(`update ${await relationOf('Sst Stray')} set submission_status = 'Open'`)
    await refused('Sst Stray', 'status', 'rename submission_status to status')
  })
})
