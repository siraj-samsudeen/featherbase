// The same real runtime package and core Tables as platform-test/report.test.ts. Dash copies no
// figures (#1366): the report is its Dive, whose embed session page-test's MotherDuck stand-in mints.
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import type { CreateUserFn, TestClient } from '../../../../apps/server/node_modules/feather-testing-postgres'
import { discoverPackages } from '../../../../apps/server/src/runtime-packages'
// @ts-expect-error a plain .mjs module
import { ACCESS_ROWS, BASE_TABLES, LINKED_TABLES, REPORT_ROWS } from '../platform-test/base-tables.mjs'

export async function setupDash(admin: TestClient, createUser: CreateUserFn) {
  expect(await discoverPackages([new URL('..', import.meta.url).pathname])).toEqual([])
  await admin.post('/api/install_app', { name: 'dash' })
  for (const table of BASE_TABLES) await admin.post('/api/table_def', table)
  await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'dash.linked_tables', value: JSON.stringify(LINKED_TABLES) } })
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  const headers = { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `dash@${version}` }
  const save = async (table: string, row: Record<string, unknown>) => {
    const response = await admin.fetch('/api/save_row', { method: 'POST', headers,
      body: JSON.stringify({ table, row }) })
    expect([200, 201], await response.clone().text()).toContain(response.status)
    return await response.json() as { row_id: string }
  }
  for (const [code, name] of [['LKS', 'Lakeside'], ['HIL', 'Hillview']]) await save('Site', { code, name, is_store: true })
  await save('Plant', { plant_code: '9901', plant_type: 'Store', site: 'LKS' })
  await save('Plant', { plant_code: '9902', plant_type: 'Store', site: 'HIL' })
  let numbers = 0
  /** A person on the staff list, known by their sign-in, with one more job (at Lakeside unless told). */
  const employees = new Map<string, string>()
  const job = async (person: string, job: string, values: Record<string, unknown> = {}) => {
    let employee = employees.get(person)
    if (!employee) {
      employee = String(++numbers)
      employees.set(person, employee)
      await save('Employee', { employee_code: employee, name: `Made-up ${employee}`, person, status: 'Current' })
    }
    return save('Job Assignment', { assignment_id: `JA-${employee}-${++numbers}`, employee, job, site: 'LKS', starts_on: '2026-01-01', ...values })
  }
  const section = async (row_id: string, name: string) => save('Section', { row_id, name, site: 'LKS', status: 'Active' })
  const place = async (subcategory: string, onSection: string) => {
    await save('Subcategory', { row_id: subcategory, subcategory: `Made-up ${subcategory}`, subcategory_type: 'Merchandise' })
    return save('Section Subcategory', { section_subcategory_id: `P-${subcategory}`, store: 'LKS', subcategory, section: onSection, starts_on: '2026-01-01' })
  }
  for (const row of REPORT_ROWS) await save('dash.report', row)
  for (const row of ACCESS_ROWS) await save('dash.report_access', row)
  const sarees = await section('LKS-S1', 'Sarees')
  for (const subcategory of ['010101001', '010101002', '010101003']) await place(subcategory, sarees.row_id)
  // The reader the page is opened as: a Team Leader of Sarees at Lakeside.
  const reader = await createUser({ email: 'dash-ui-leader@example.test', roles: ['Dash Reader'] })
  const lead = await job(reader.user!, 'Team Leader', { section: sarees.row_id })
  await admin.post('/api/table/Data%20Source', { row_id: 'motherduck', engine: 'duckdb', url_env: 'DASH_UI_DUCKDB', access: 'read_only' })
  // The Dive's service account: with it (and the embed token the config sets) every report opens its Dive.
  await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'dash.embed_service_account', value: 'svc-made-up' } })
  return { reader, section: sarees, addSection: section, place, lead, job, save }
}
