// A Department Manager sets up their own department (#1195) on the real platform: the app's reads
// and actions, the platform's change proposals, and the scope provider reading what was applied.
// Made-up stores and people only.
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, vi } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test as pgTest } from '../pg-test'
import { sql } from '../../src/db'
import { tableRelation } from '../../src/table-engine'
import { availableRuntimeVersions } from '../../src/runtime-packages'
import { NoPersonScope, resolvePersonScope } from '../../src/person-scope'
import { APP_DIR, VERSION, createCoreTables, installApp, pinned, saveRow } from './helpers'

vi.setConfig({ testTimeout: 60_000 })
process.env.MOTHERDUCK_TOKEN = 'made-up-token'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
const read = async (client: TestClient, name: string, payload: object = {}) =>
  (await client.post<any>(`/api/app_reads/dash/${name}`, { payload })).result
const act = async (client: TestClient, name: string, payload: object) =>
  (await client.post<any>(`/api/app_actions/dash/${name}`, { idempotencyKey: randomUUID(), payload })).result
const rows = async (table: string) => sql`select * from ${sql(await tableRelation(table))} order by row_id`

async function binding() {
  const manifest = JSON.parse(await readFile(resolve(APP_DIR, 'featherbase.json'), 'utf8'))
  const digest = availableRuntimeVersions().find(p => p.name === 'dash')!.digest
  const module = await import(`${pathToFileURL(resolve(APP_DIR, 'dist/server.mjs')).href}?artifact=${digest}`)
  return { app: 'dash', title: manifest.title, version: VERSION, tables: manifest.scopeProvider.tables, unmarkedTables: manifest.scopeProvider.unmarkedTables,
    identifiers: manifest.scopeProvider.identifiers ?? [], provide: module.scopeProviders.org_chart }
}
const sections = (scope: { label: string; filters: Record<string, string[]> }[]) => scope.map(place => [place.label, place.filters.subcategory])

async function world(admin: TestClient, createUser: CreateUserFn) {
  await installApp(admin)
  await createCoreTables(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Master Data Editor' } })
  const save = (table: string, values: Record<string, unknown>) => saveRow(admin, table, values)
  const person = (name: string) => createUser({ email: `${name}-${randomUUID()}@example.test`, roles: ['Dash Reader'] })
  const [deepa, mani] = await Promise.all(['deepa', 'mani'].map(person))
  await sql`update person set password_hash = 'made-up' where row_id in ${sql([deepa, mani].map(p => p.user!))}`
  for (const [code, name] of [['LKS', 'Lakeside'], ['RIV', 'Riverside']]) await save('Site', { code, name, is_store: true })
  await save('Plant', { plant_code: '9901', plant_type: 'Store', site: 'LKS' })
  await save('Plant', { plant_code: '9903', plant_type: 'Store', site: 'RIV' })
  await save('Store Floor', { row_id: 'LKS-F1', name: 'First floor', site: 'LKS' })
  await save('Section', { row_id: 'LKS-S1', name: 'Sarees', site: 'LKS', floor: 'LKS-F1', status: 'Active' })
  await save('Section', { row_id: 'LKS-S2', name: 'Silk', site: 'LKS', floor: 'LKS-F1', status: 'Active' })
  await save('Section', { row_id: 'LKS-S3', name: 'Bags', site: 'LKS', floor: 'LKS-F1', status: 'Active' })
  await save('Subcategory', { row_id: '010101001', subcategory: 'Silk sarees', subcategory_type: 'Merchandise' })
  await save('Subcategory', { row_id: '010101002', subcategory: 'Salwar sets', subcategory_type: 'Merchandise' })
  await save('Section Subcategory', { section_subcategory_id: 'P1', store: 'LKS', subcategory: '010101001', section: 'LKS-S1', starts_on: '2026-01-01' })
  await save('Section Subcategory', { section_subcategory_id: 'P2', store: 'LKS', subcategory: '010101002', section: 'LKS-S2', starts_on: '2026-01-01' })
  await save('Employee', { employee_code: '1001', name: 'Deepa', person: deepa.user, status: 'Current' })
  await save('Employee', { employee_code: '1002', name: 'Mani', person: mani.user, status: 'Current' })
  await save('Employee', { employee_code: '1003', name: 'Asha', status: 'Current' })
  await save('Job Assignment', { assignment_id: 'JA-1', employee: '1001', job: 'Department Manager', site: 'LKS', reports_to: '1002', starts_on: '2026-01-01' })
  await save('Job Assignment', { assignment_id: 'JA-2', employee: '1002', job: 'Store Manager', site: 'LKS', starts_on: '2026-01-01' })
  await save('Job Assignment', { assignment_id: 'JA-3', employee: '1003', job: 'Team Leader', site: 'LKS', section: 'LKS-S1', reports_to: '1001', starts_on: '2026-01-01' })
  return { deepa, mani, save }
}

describe('a Department Manager sets up their department (#1195)', () => {
  test('sends it, their Store Manager keeps it, and their report reaches its sections', async ({ admin, createUser }) => {
    const { deepa, mani } = await world(admin, createUser)
    await expect(resolvePersonScope(deepa.user!, await binding())).rejects.toMatchObject(new NoPersonScope('scope'))
    expect(await read(deepa, 'reach_problem')).toEqual({ problems: ['departments_not_filled'] })

    const page = await read(deepa, 'department_setup')
    expect(page).toMatchObject({ state: 'ok', reviewer: 'Mani', start_floors: ['LKS-F1'], current: null })
    expect(page.sections.map((s: any) => [s.name, s.suggested])).toEqual([['Bags', false], ['Sarees', true], ['Silk', false]])

    const sent = await act(deepa, 'set_up_department', { job: 'JA-1', name: 'Ladies Ethnic', sections: ['LKS-S1', 'LKS-S2'] })
    expect(sent).toMatchObject({ state: 'waiting', waiting_for: 'Mani', sections: ['Sarees', 'Silk'] })
    expect(await read(mani, 'department_approvals')).toMatchObject([{ bundle: sent.bundle, who: 'Deepa', name: 'Ladies Ethnic', sections: [{ name: 'Sarees', team_leaders: ['Asha'] }, { name: 'Silk', team_leaders: [] }] }])
    expect(await read(mani, 'my_sections')).toMatchObject({ waiting_for_me: 1 })
    // The platform, not only the app, refuses the maker deciding their own.
    await expect(act(deepa, 'decide_department', { bundle: sent.bundle, decision: 'approve' })).rejects.toThrow()

    expect(await act(mani, 'decide_department', { bundle: sent.bundle, decision: 'approve' })).toMatchObject({ state: 'Applied' })
    const [department] = await rows('Department')
    expect(department).toMatchObject({ store: 'LKS', name: 'Ladies Ethnic', manager: '1001' })
    expect((await rows('Department Section')).map(r => [r.section, r.department])).toEqual([['LKS-S1', department.row_id], ['LKS-S2', department.row_id]])

    expect(sections(await resolvePersonScope(deepa.user!, await binding()))).toEqual([['9901 / Section: Sarees', ['010101001']], ['9901 / Section: Silk', ['010101002']]])
    expect(await read(deepa, 'reach_problem')).toEqual({ problems: [] })
    expect(await read(deepa, 'department_setup')).toMatchObject({ current: { state: 'set_up', name: 'Ladies Ethnic', sections: ['Sarees', 'Silk'] } })
  })

  test('turned down, they see why; withdrawn, nothing is left waiting', async ({ admin, createUser }) => {
    const { deepa, mani } = await world(admin, createUser)
    const first = await act(deepa, 'set_up_department', { job: 'JA-1', name: 'Ladies', sections: ['LKS-S3'] })
    await act(mani, 'decide_department', { bundle: first.bundle, decision: 'reject', reason: 'Bags belongs to Accessories' })
    expect(await read(deepa, 'department_setup')).toMatchObject({ current: { state: 'turned_down', reason: 'Bags belongs to Accessories' } })
    expect(await rows('Department')).toEqual([])

    const second = await act(deepa, 'set_up_department', { job: 'JA-1', name: 'Ladies', sections: ['LKS-S1'] })
    expect(await act(deepa, 'withdraw_department', { bundle: second.bundle })).toEqual({ withdrawn: 2 })
    expect(await read(mani, 'department_approvals')).toEqual([])
  })

  test("a store with no sections says so, and can't be sent", async ({ admin, createUser }) => {
    const { deepa } = await world(admin, createUser)
    await sql`update ${sql(await tableRelation('Job Assignment'))} set site = 'RIV' where row_id = 'JA-1'`
    expect(await read(deepa, 'reach_problem')).toEqual({ problems: ['store_sections_not_set_up'] })
    expect(await read(deepa, 'department_setup')).toMatchObject({ state: 'no_sections', job: { store: 'Riverside' }, reviewer: 'Mani' })
    await expect(act(deepa, 'set_up_department', { job: 'JA-1', name: 'Ladies', sections: ['LKS-S1'] })).rejects.toThrow('Pick sections in Riverside')
  })
})

// #1191 on its real platform: Department set-up set to "Apply now, review after" on this instance.
describe('a Department Manager sets up their department, applied at once (#1191)', () => {
  const applyNow = (admin: TestClient) => admin.post('/api/save_row', { table: 'Approval Type', row: { row_id: 'dash.department_setup', mode: 'Apply now, review after' } })
  const live = async (table: string) => (await rows(table)).filter(r => !r.retired_at)

  test('the report opens at once; the reviewer keeps it with confirm', async ({ admin, createUser }) => {
    const { deepa, mani } = await world(admin, createUser)
    await applyNow(admin)
    const sent = await act(deepa, 'set_up_department', { job: 'JA-1', name: 'Ladies Ethnic', sections: ['LKS-S1', 'LKS-S2'] })
    expect(sent).toMatchObject({ state: 'set_up' })
    const [department] = await live('Department')
    expect((await live('Department Section')).map(r => [r.section, r.department])).toEqual([['LKS-S1', department.row_id], ['LKS-S2', department.row_id]])
    expect(sections(await resolvePersonScope(deepa.user!, await binding()))).toEqual([['9901 / Section: Sarees', ['010101001']], ['9901 / Section: Silk', ['010101002']]])
    expect(await read(deepa, 'department_setup')).toMatchObject({ current: { state: 'set_up', reviewing: { waiting_for: 'Mani' } } })
    expect(await read(mani, 'department_approvals')).toMatchObject([{ bundle: sent.bundle, applied: true }])

    expect(await act(mani, 'decide_department', { bundle: sent.bundle, decision: 'approve' })).toMatchObject({ state: 'Confirmed', department: department.row_id })
    expect(await read(mani, 'department_approvals')).toEqual([])
    expect(await read(deepa, 'department_setup')).toMatchObject({ current: { state: 'set_up', reviewing: null } })
  })

  test('the reviewer undoes it, links first, and the report closes again', async ({ admin, createUser }) => {
    const { deepa, mani } = await world(admin, createUser)
    await applyNow(admin)
    const sent = await act(deepa, 'set_up_department', { job: 'JA-1', name: 'Ladies Ethnic', sections: ['LKS-S1'] })
    expect(await act(mani, 'decide_department', { bundle: sent.bundle, decision: 'reject', reason: 'Sarees is in Ethnic' })).toMatchObject({ state: 'Undone' })
    expect([await live('Department'), await live('Department Section')]).toEqual([[], []])
    await expect(resolvePersonScope(deepa.user!, await binding())).rejects.toMatchObject(new NoPersonScope('scope'))
    expect(await read(deepa, 'reach_problem')).toEqual({ problems: ['departments_not_filled'] })
    expect(await read(deepa, 'department_setup')).toMatchObject({ current: { state: 'turned_down', reason: 'Sarees is in Ethnic' } })
  })

  test('the maker takes it back, or changes it, with no reason; leaving a section out undoes only that one', async ({ admin, createUser }) => {
    const { deepa, mani } = await world(admin, createUser)
    await applyNow(admin)
    const first = await act(deepa, 'set_up_department', { job: 'JA-1', name: 'Ladies', sections: ['LKS-S1', 'LKS-S2'] })
    const second = await act(deepa, 'set_up_department', { job: 'JA-1', name: 'Ladies Ethnic', sections: ['LKS-S1', 'LKS-S3'], replaces: first.bundle })
    expect((await live('Department')).map(r => r.name)).toEqual(['Ladies Ethnic'])
    expect((await live('Department Section')).map(r => r.section).sort()).toEqual(['LKS-S1', 'LKS-S3'])
    await act(mani, 'decide_department', { bundle: second.bundle, decision: 'approve', sections: ['LKS-S1'] })
    expect((await live('Department Section')).map(r => r.section)).toEqual(['LKS-S1'])
    const third = await act(deepa, 'set_up_department', { job: 'JA-1', name: 'x', sections: ['LKS-S2'] }).catch((e: Error) => e.message)
    expect(third).toMatch(/You already have a department here/)
  })
})
