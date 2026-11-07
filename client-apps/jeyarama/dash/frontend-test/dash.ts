// The same real runtime package, core Tables and cached dataset storage
// as platform-test/report.test.ts. No warehouse or HTTP response stand-ins.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import type { CreateUserFn, TestClient } from '../../../../apps/server/node_modules/feather-testing-postgres'
import { discoverPackages } from '../../../../apps/server/src/runtime-packages'
import { datasetsDeclaration } from '../../../../apps/server/src/app-datasets'
import { sql } from '../../../../apps/server/src/db'
// @ts-expect-error a plain .mjs module
import { BASE_TABLES, LINKED_TABLES, REPORT_ROWS } from '../platform-test/base-tables.mjs'
// @ts-expect-error a plain .mjs module
import { markScopeTables } from '../platform-test/mark-scope-tables.mjs'

export async function setupDash(admin: TestClient, createUser: CreateUserFn) {
  expect(await discoverPackages([new URL('..', import.meta.url).pathname])).toEqual([])
  await admin.post('/api/install_app', { name: 'dash' })
  for (const table of BASE_TABLES) await admin.post('/api/table_def', table)
  await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'dash.linked_tables', value: JSON.stringify(LINKED_TABLES) } })
  await markScopeTables((path: string, init?: RequestInit) => init?.method === 'PUT' ? admin.fetch(path, init).then(r => r.json()) : admin.get(path))
  const manifest = JSON.parse(readFileSync(new URL('../featherbase.json', import.meta.url), 'utf8'))
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
  const sarees = await section('LKS-S1', 'Sarees')
  for (const subcategory of ['010101001', '010101002', '010101003']) await place(subcategory, sarees.row_id)
  // The reader the page is opened as: a Team Leader of Sarees at Lakeside.
  const reader = await createUser({ email: 'dash-ui-leader@example.test', roles: ['Dash Reader'] })
  const lead = await job(reader.user!, 'Team Leader', { section: sarees.row_id })
  await admin.post('/api/table/Data%20Source', { row_id: 'motherduck', engine: 'duckdb', url_env: 'DASH_UI_DUCKDB', access: 'read_only' })
  const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
  const fact = (subcategory_code: string, values: Record<string, unknown> = {}) => ({
    subcategory_code, subcategory: 'Silk', target: 1000, actual: 800,
    store_code: '9901', store_name: 'Lakeside', short_code: 'LKS', days_with_actual: 1,
    days: 1, period_start: `${day.slice(0, 8)}01`, data_through: day, targets_available: true, ...values,
  })
  const snapshot = async (rows: Record<string, unknown>[], name = 'sales_to_date') => {
    const dataset = datasetsDeclaration.parse(manifest.datasets).find(d => d.name === name)!
    const definition = createHash('sha256').update(JSON.stringify({ ...dataset, guard: undefined })).digest('hex').slice(0, 16)
    await sql`update dataset_snapshot set state = 'superseded' where dataset = ${`dash.${name}`} and state = 'active'`
    const id = randomUUID()
    await sql`insert into dataset_snapshot (row_id, dataset, definition_version, state, built_at, activated_at, row_count)
      values (${id}, ${`dash.${name}`}, ${definition}, 'active', now(), now(), ${rows.length})`
    for (let start = 0; start < rows.length; start += 500)
      await sql`insert into app_dataset_row ${sql(rows.slice(start, start + 500).map(row => ({ snapshot_id: id, row: sql.json(row) })), 'snapshot_id', 'row')}`
  }
  const facts = [fact('010101001'), fact('010101002', { subcategory: 'Quiet cotton', target: 0, actual: 0 }),
    fact('010101003', { subcategory: 'Sales only', target: null, actual: 100 })]
  await snapshot(facts)
  await snapshot(facts, 'sales_month')
  return { reader, section: sarees, addSection: section, place, lead, job, save, fact, facts, snapshot, day }
}
