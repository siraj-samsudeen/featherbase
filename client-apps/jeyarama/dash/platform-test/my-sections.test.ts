// Your sections (#975) on the real platform: every rule through the app's own reads and actions.
// The base Tables hold made-up stores and people only.
import { randomUUID } from 'node:crypto'
import { describe, expect, vi } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test as pgTest } from '../pg-test'
import { sql } from '../../src/db'
import { tableRelation } from '../../src/table-engine'
import { BASE_TABLES, LINKED_TABLES } from './base-tables.mjs'
import { installApp, pinned, saveRow } from './helpers'

vi.setConfig({ testTimeout: 60_000 })
process.env.MOTHERDUCK_TOKEN = 'made-up-token'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
const read = async (client: TestClient, name: string, payload: object = {}) =>
  (await client.post<any>(`/api/app_reads/feather_dash/${name}`, { payload })).result
const act = async (client: TestClient, name: string, payload: object) =>
  (await client.post<any>(`/api/app_actions/feather_dash/${name}`, { idempotencyKey: randomUUID(), payload })).result
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
const asDay = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : value)
const row = async (table: string, id: string) => (await sql`select * from ${sql(await tableRelation(table))} where row_id = ${id}`)[0]
const READER = { roles: ['Feather Dash Reader'] }

async function world(admin: TestClient, createUser: CreateUserFn) {
  await installApp(admin)
  for (const table of BASE_TABLES) await admin.post('/api/table_def', table)
  await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'feather_dash.linked_tables', value: JSON.stringify(LINKED_TABLES) } })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Master Data Editor' } })
  const save = (table: string, values: Record<string, unknown>) => saveRow(admin, table, values)
  const person = (name: string, roles = READER.roles) => createUser({ email: `${name}-${randomUUID()}@example.test`, roles })
  const [maker, manager, editor, stranger, otherStaff] = await Promise.all(['maker', 'manager', 'editor', 'stranger', 'other'].map(n => person(n)))
  await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values (${randomUUID()}, ${editor.user!}, 'Person', 'roles', 'Master Data Editor')`
  for (const [site_code, site_name] of [['LKS', 'Lakeside'], ['HIL', 'Hillview']]) await save('Site Master', { site_code, site_name, is_store: true })
  await save('Store Floor', { floor_id: 'LKS-F1', floor_name: 'First floor', site: 'LKS' })
  await save('Store Floor', { floor_id: 'LKS-F2', floor_name: 'Second floor', site: 'LKS' })
  await save('Section', { section_id: 'LKS-S1', section_name: 'Ladies Wear', site: 'LKS', floor: 'LKS-F1', section_status: 'Active' })
  await save('Section', { section_id: 'LKS-S2', section_name: 'Silk', site: 'LKS', floor: 'LKS-F2', section_status: 'Active' })
  await save('Section', { section_id: 'LKS-S3', section_name: 'Closed Corner', site: 'LKS', floor: 'LKS-F2', section_status: 'Inactive' })
  await save('Section', { section_id: 'HIL-S1', section_name: 'Hillview Silk', site: 'HIL', section_status: 'Active' })
  for (const [code, name] of [['010101001', 'Sarees'], ['010101002', 'Kurtis'], ['010101003', 'Silk Sarees'], ['010101004', 'Sari Blouses']])
    await save('Subcategory', { row_id: code, subcategory: name, is_merchandise: true })
  await save('Subcategory', { row_id: '990101001', subcategory: 'Sari Hangers', is_merchandise: false })
  for (const [id, sub, section] of [['LKS-1', '010101001', 'LKS-S1'], ['LKS-2', '010101002', 'LKS-S1'], ['LKS-3', '010101003', 'LKS-S2']])
    await save('Section Subcategory', { placement_id: id, site: 'LKS', subcategory: sub, section, starts_on: '2026-10-01' })
  await save('Employee', { employee_id: '1001', employee_name: 'Asha Maker', person: maker.user, employee_status: 'Current' })
  await save('Employee', { employee_id: '1002', employee_name: 'Mani Manager', person: manager.user, employee_status: 'Current' })
  await save('Employee', { employee_id: '1003', employee_name: 'No Login Manager', employee_status: 'Current' })
  await save('Employee', { employee_id: '1004', employee_name: 'Other Staff', person: otherStaff.user, employee_status: 'Current' })
  const job = await save('Job Assignment', { assignment_id: 'JA-1', employee: '1001', job: 'Team Leader', site: 'LKS', section: 'LKS-S1', reports_to: '1002', starts_on: '2026-10-01' })
  await save('Job Assignment', { assignment_id: 'JA-4', employee: '1004', job: 'Staff', site: 'LKS', reports_to: '1003', starts_on: '2026-10-01' })
  return { maker, manager, editor, stranger, otherStaff, job, save }
}

const move = (over: object = {}) => ({ job: 'JA-1', placement: 'LKS-1', to_section: 'LKS-S2', ...over })

describe('what a person sees', () => {
  test('their job, store, manager, section with floor and subcategories, by name', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    const answer = await read(maker, 'my_sections')
    expect(answer).toMatchObject({ state: 'ok', name: 'Asha Maker', proposals: [], waiting_for_me: 0 })
    expect(answer.jobs).toHaveLength(1)
    expect(answer.jobs[0]).toMatchObject({ job: 'Team Leader', store: 'Lakeside', reports_to: 'Mani Manager', waiting_for: 'Mani Manager',
      section: { name: 'Ladies Wear', floor: 'First floor' } })
    expect(answer.jobs[0].subcategories.map((s: any) => s.name)).toEqual(['Kurtis', 'Sarees'])
    // Open sections of this store only: not the closed one, not another store's, not their own.
    expect(answer.jobs[0].other_sections.map((s: any) => s.name)).toEqual(['Silk'])
    expect(JSON.stringify(answer)).not.toContain('Other Staff')
  })

  test('a job with no section, someone the staff list does not know, and an instance not set up', async ({ admin, createUser }) => {
    const { otherStaff, stranger } = await world(admin, createUser)
    const answer = await read(otherStaff, 'my_sections')
    expect(answer.jobs[0]).toMatchObject({ section: null, subcategories: [], reports_to: 'No Login Manager', waiting_for: 'the master data team' })
    expect(await read(stranger, 'my_sections')).toEqual({ state: 'unknown_person' })
    const [setting] = await sql`select updated_at from app_setting where row_id = 'feather_dash.linked_tables'`
    await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'feather_dash.linked_tables', updated_at: setting.updated_at, value: '[]' } })
    expect(await read(stranger, 'my_sections')).toEqual({ state: 'not_set_up' })
  })

  test('staff read all this with no grant on the base Tables, which stay closed to them', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    await expect(maker.get('/api/table/Employee')).rejects.toMatchObject({ status: 403 })
    await expect(maker.get('/api/table/Job%20Assignment')).rejects.toMatchObject({ status: 403 })
  })

  test('the search finds this store\'s subcategories with where they are now, not its own, not non-merchandise', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    const found = await read(maker, 'subcategory_search', { job: 'JA-1', query: 'sar' })
    expect(found).toEqual([
      { code: '010101003', name: 'Silk Sarees', now_in: 'Silk' },
      { code: '010101004', name: 'Sari Blouses', now_in: null },
    ])
    expect(await read(maker, 'subcategory_search', { job: 'JA-1', query: 's' })).toEqual([])
    await expect(read(maker, 'subcategory_search', { job: 'JA-4', query: 'sar' })).rejects.toMatchObject({ status: 417 })
  })
})

describe('what a person may propose', () => {
  test('a move waits for the manager, and the row stays', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_move', move())
    expect(proposal).toMatchObject({ kind: 'move', what: 'Sarees', from: 'Ladies Wear', to: 'Silk', store: 'Lakeside', state: 'Pending', waiting_for: 'Mani Manager' })
    expect(await row('Section Subcategory', 'LKS-1')).toMatchObject({ section: 'LKS-S1', ends_on: null })
    expect((await read(maker, 'my_sections')).proposals).toEqual([expect.objectContaining({ id: proposal.id, state: 'Pending' })])
  })

  test('refused: another store, a closed section, not their section, not their job', async ({ admin, createUser }) => {
    const { maker, otherStaff, stranger } = await world(admin, createUser)
    await expect(act(maker, 'propose_move', move({ to_section: 'HIL-S1' }))).rejects.toMatchObject({ status: 417 })
    await expect(act(maker, 'propose_move', move({ to_section: 'LKS-S3' }))).rejects.toMatchObject({ status: 417 })
    await expect(act(maker, 'propose_move', move({ placement: 'LKS-3' }))).rejects.toMatchObject({ status: 417 })
    await expect(act(maker, 'propose_section', { job: 'JA-1', to_section: 'HIL-S1' })).rejects.toMatchObject({ status: 417 })
    await expect(act(otherStaff, 'propose_move', move())).rejects.toMatchObject({ status: 417 })
    await expect(act(otherStaff, 'propose_section', { job: 'JA-1', to_section: 'LKS-S2' })).rejects.toMatchObject({ status: 417 })
    await expect(act(stranger, 'propose_section', { job: 'JA-1', to_section: 'LKS-S2' })).rejects.toMatchObject({ status: 417 })
    expect((await sql`select count(*)::int as n from change_proposal`)[0].n).toBe(0)
  })

  test('adding from elsewhere in the store, adding what no section has, and nothing already theirs', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    expect(await act(maker, 'propose_add', { job: 'JA-1', subcategory: '010101003' })).toMatchObject({ kind: 'add', what: 'Silk Sarees', from: 'Silk', to: 'Ladies Wear' })
    expect(await act(maker, 'propose_add', { job: 'JA-1', subcategory: '010101004' })).toMatchObject({ kind: 'add', what: 'Sari Blouses', from: 'No section', to: 'Ladies Wear' })
    await expect(act(maker, 'propose_add', { job: 'JA-1', subcategory: '010101001' })).rejects.toMatchObject({ status: 417 })
    await expect(act(maker, 'propose_add', { job: 'JA-1', subcategory: '990101001' })).rejects.toMatchObject({ status: 417 })
  })

  test('with nobody else to approve, it is refused saying so', async ({ admin, createUser }) => {
    const { otherStaff, editor } = await world(admin, createUser)
    await sql`delete from has_role where parent = ${editor.user!} and role = 'Master Data Editor'`
    await expect(act(otherStaff, 'propose_section', { job: 'JA-4', to_section: 'LKS-S2' })).rejects.toMatchObject({ status: 417, message: expect.stringContaining('Nobody else can approve') })
  })
})

describe('what an approver decides', () => {
  test('the manager sees it, approves, the old placement ends and a new one starts today', async ({ admin, createUser }) => {
    const { maker, manager, otherStaff } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_move', move())
    const { proposals } = await read(manager, 'approvals')
    expect(proposals).toEqual([expect.objectContaining({ id: proposal.id, who: 'Asha Maker', what: 'Sarees', from: 'Ladies Wear', to: 'Silk', store: 'Lakeside' })])
    expect((await read(otherStaff, 'approvals')).proposals).toEqual([])
    expect((await read(maker, 'approvals')).proposals).toEqual([])
    expect(await act(manager, 'decide', { proposal: proposal.id, decision: 'approve' })).toMatchObject({ state: 'Applied' })
    const old = await row('Section Subcategory', 'LKS-1')
    expect(old.section).toBe('LKS-S1')
    expect(asDay(old.ends_on)).toBe(yesterday)
    const added = await row('Section Subcategory', `LKS-010101001-${today}`)
    expect(added).toMatchObject({ section: 'LKS-S2', site: 'LKS', subcategory: '010101001', created_by: maker.user, ends_on: null })
    expect(asDay(added.starts_on)).toBe(today)
    const after = await read(maker, 'my_sections')
    expect(after.jobs[0].subcategories.map((s: any) => s.name)).toEqual(['Kurtis'])
    expect(after.proposals[0]).toMatchObject({ state: 'Applied', decided_on: today })
  })

  test('a section change ends and adds the job, keeping everything else', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_section', { job: 'JA-1', to_section: 'LKS-S2' })
    expect(proposal).toMatchObject({ kind: 'section', from: 'Ladies Wear', to: 'Silk', state: 'Pending' })
    await act(manager, 'decide', { proposal: proposal.id, decision: 'approve' })
    expect(asDay((await row('Job Assignment', 'JA-1')).ends_on)).toBe(yesterday)
    const added = await row('Job Assignment', `JA-1001-LKS-S2-${today}`)
    expect(added).toMatchObject({ employee: '1001', job: 'Team Leader', site: 'LKS', section: 'LKS-S2', reports_to: '1002', ends_on: null })
    expect((await read(maker, 'my_sections')).jobs[0].section.name).toBe('Silk')
  })

  test('a rejection needs a reason, changes nothing, and the person reads it', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_move', move())
    await expect(act(manager, 'decide', { proposal: proposal.id, decision: 'reject' })).rejects.toMatchObject({ status: 417 })
    await act(manager, 'decide', { proposal: proposal.id, decision: 'reject', reason: 'Sarees stay with Ladies Wear' })
    expect(await row('Section Subcategory', 'LKS-1')).toMatchObject({ section: 'LKS-S1', ends_on: null })
    expect((await read(maker, 'my_sections')).proposals[0]).toMatchObject({ state: 'Rejected', reason: 'Sarees stay with Ladies Wear' })
  })

  test('nobody decides their own or someone else\'s, System Manager included', async ({ admin, createUser }) => {
    const { maker, otherStaff, editor } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_move', move())
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values (${randomUUID()}, ${maker.user!}, 'Person', 'roles', 'System Manager')`
    for (const who of [maker, otherStaff, editor, admin])
      await expect(act(who, 'decide', { proposal: proposal.id, decision: 'approve' })).rejects.toBeTruthy()
    expect(await row('Section Subcategory', 'LKS-1')).toMatchObject({ section: 'LKS-S1', ends_on: null })
  })

  test('with a manager who has no sign-in, a Master Data Editor decides, and never their own', async ({ admin, createUser }) => {
    const { otherStaff, editor, manager, save } = await world(admin, createUser)
    const proposal = await act(otherStaff, 'propose_section', { job: 'JA-4', to_section: 'LKS-S2' })
    expect(proposal.waiting_for).toBe('the master data team')
    expect((await read(manager, 'approvals')).proposals).toEqual([])
    expect((await read(editor, 'approvals')).proposals.map((p: any) => p.id)).toEqual([proposal.id])
    await expect(act(manager, 'decide', { proposal: proposal.id, decision: 'approve' })).rejects.toMatchObject({ status: 417 })
    // An editor on the staff asks about their own job: they see it as theirs, not as one to approve.
    await save('Employee', { employee_id: '1005', employee_name: 'Eli Editor', person: editor.user, employee_status: 'Current' })
    await save('Job Assignment', { assignment_id: 'JA-5', employee: '1005', job: 'Staff', site: 'LKS', starts_on: '2026-10-01' })
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values (${randomUUID()}, ${manager.user!}, 'Person', 'roles', 'Master Data Editor')`
    const own = await act(editor, 'propose_section', { job: 'JA-5', to_section: 'LKS-S2' })
    expect((await read(editor, 'approvals')).proposals.map((p: any) => p.id)).toEqual([proposal.id])
    await expect(act(editor, 'decide', { proposal: own.id, decision: 'approve' })).rejects.toMatchObject({ status: 417 })
    await act(editor, 'decide', { proposal: proposal.id, decision: 'approve' })
    expect(asDay((await row('Job Assignment', 'JA-4')).ends_on)).toBe(yesterday)
  })

  test('a section closed, a section moved on, or a row changed: Needs fresh review, nothing changes', async ({ admin, createUser }) => {
    const { maker, manager, job } = await world(admin, createUser)
    const closed = await act(maker, 'propose_move', move())
    const [section] = await sql`select updated_at from ${sql(await tableRelation('Section'))} where row_id = 'LKS-S2'`
    const shut = await saveRow(admin, 'Section', { row_id: 'LKS-S2', updated_at: section.updated_at, section_status: 'Inactive' })
    expect(await act(manager, 'decide', { proposal: closed.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    await saveRow(admin, 'Section', { row_id: 'LKS-S2', updated_at: shut.updated_at, section_status: 'Active' })
    const moved = await act(maker, 'propose_move', { ...move(), placement: 'LKS-2' })
    await saveRow(admin, 'Job Assignment', { row_id: 'JA-1', updated_at: job.updated_at, section: 'LKS-S2' })
    expect(await act(manager, 'decide', { proposal: moved.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    expect(await row('Section Subcategory', 'LKS-2')).toMatchObject({ section: 'LKS-S1', ends_on: null })
    expect((await read(maker, 'my_sections')).proposals.every((p: any) => p.state === 'Needs fresh review')).toBe(true)
  })

  test('a placement that now holds another subcategory is not what was reviewed', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_move', move())
    const [placement] = await sql`select updated_at from ${sql(await tableRelation('Section Subcategory'))} where row_id = 'LKS-1'`
    await saveRow(admin, 'Section Subcategory', { row_id: 'LKS-1', updated_at: placement.updated_at, subcategory: '010101004' })
    expect(await act(manager, 'decide', { proposal: proposal.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    expect(await row('Section Subcategory', 'LKS-1')).toMatchObject({ section: 'LKS-S1', ends_on: null })
  })

  test('the same day twice: the new rows do not collide, and today has one answer', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    const first = await act(maker, 'propose_section', { job: 'JA-1', to_section: 'LKS-S2' })
    await act(manager, 'decide', { proposal: first.id, decision: 'approve' })
    const second = await act(maker, 'propose_section', { job: `JA-1001-LKS-S2-${today}`, to_section: 'LKS-S1' })
    await act(manager, 'decide', { proposal: second.id, decision: 'approve' })
    const third = await act(maker, 'propose_section', { job: `JA-1001-LKS-S1-${today}`, to_section: 'LKS-S2' })
    await act(manager, 'decide', { proposal: third.id, decision: 'approve' })
    const { jobs } = await read(maker, 'my_sections')
    expect(jobs.map((j: any) => j.section.name)).toEqual(['Silk'])
  })
})
