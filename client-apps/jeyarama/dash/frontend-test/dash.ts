// The same real runtime package, org-chart Tables and cached dataset storage
// as platform-test/report.test.ts. No warehouse or HTTP response stand-ins.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import type { CreateUserFn, TestClient } from '../../../../apps/server/node_modules/feather-testing-postgres'
import { discoverPackages } from '../../../../apps/server/src/runtime-packages'
import { applySeedPack } from '../../../../apps/server/src/seed-packs'
import { datasetsDeclaration } from '../../../../apps/server/src/app-datasets'
import { sql } from '../../../../apps/server/src/db'

export async function setupDash(admin: TestClient, createUser: CreateUserFn) {
  await applySeedPack('jeyarama')
  expect(await discoverPackages([new URL('..', import.meta.url).pathname])).toEqual([])
  await admin.post('/api/install_app', { name: 'feather_dash' })
  for (const [name, fields] of Object.entries({
    'Sales Target Assignment': ['employee', 'plant_code', 'store_label', 'material_group'],
    'Employee Section Map': ['store_code', 'employee_code', 'subcategory', 'section_name'],
    'Section Ownership': ['store_code', 'section_name', 'tl_employee_code', 'dm_employee_code', 'effective_from'],
    'Store Manager': ['store_code', 'employee_code', 'full_name', 'email'],
    'Section Merchandise Map': ['store_code', 'material_group', 'mch_subcategory', 'section_name'],
    'Section Name Alias': ['store_code', 'merch_section_name', 'roster_section_name'],
  })) await admin.post('/api/table_def', { name, module: 'Store Sections', decides_scope: true,
    columns: fields.map(column_name => ({ column_name, column_type: 'Data' })) })
  const manifest = JSON.parse(readFileSync(new URL('../featherbase.json', import.meta.url), 'utf8'))
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  const headers = { 'Content-Type': 'application/json', 'X-Featherbase-App-Version': `feather_dash@${version}` }
  const save = async (table: string, row: Record<string, unknown>) => {
    const response = await admin.fetch('/api/save_row', { method: 'POST', headers,
      body: JSON.stringify({ table: /^[a-z_]+$/.test(table) ? `feather_dash.${table}` : table, row }) })
    expect(response.status).toBe(row.row_id ? 200 : 201)
    return await response.json() as { row_id: string }
  }
  const reader = await createUser({ email: 'dash-ui-manager@example.test', roles: ['Dash Reader'] })
  await save('store_rollout', { store: '9901', live_since: '2026-01-01' })
  const section = await save('section', { store: '9901', section_name: 'Sarees' })
  for (const subcategory of ['010101001', '010101002', '010101003'])
    await save('section_subcategory', { store: '9901', subcategory, section: section.row_id, starts_on: '2026-01-01' })
  const job = await save('job_assignment', { person: reader.user, job: 'Store Manager', store: '9901', starts_on: '2026-01-01' })
  await admin.post('/api/table/Data%20Source', { row_id: 'motherduck', engine: 'duckdb', url_env: 'FEATHER_DASH_UI_DUCKDB', access: 'read_only' })
  const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
  const fact = (subcategory_code: string, values: Record<string, unknown> = {}) => ({
    subcategory_code, subcategory: 'Silk', target: 1000, actual: 800,
    store_code: '9901', store_name: 'Lakeside', short_code: 'LKS', days_with_actual: 1,
    days: 1, period_start: `${day.slice(0, 8)}01`, data_through: day, targets_available: true, ...values,
  })
  const snapshot = async (rows: Record<string, unknown>[], name = 'sales_to_date') => {
    const dataset = datasetsDeclaration.parse(manifest.datasets).find(d => d.name === name)!
    const definition = createHash('sha256').update(JSON.stringify({ ...dataset, guard: undefined })).digest('hex').slice(0, 16)
    await sql`update dataset_snapshot set state = 'superseded' where dataset = ${`feather_dash.${name}`} and state = 'active'`
    const id = randomUUID()
    await sql`insert into dataset_snapshot (row_id, dataset, definition_version, state, built_at, activated_at, row_count)
      values (${id}, ${`feather_dash.${name}`}, ${definition}, 'active', now(), now(), ${rows.length})`
    for (let start = 0; start < rows.length; start += 500)
      await sql`insert into app_dataset_row ${sql(rows.slice(start, start + 500).map(row => ({ snapshot_id: id, row: sql.json(row) })), 'snapshot_id', 'row')}`
  }
  const facts = [fact('010101001'), fact('010101002', { subcategory: 'Quiet cotton', target: 0, actual: 0 }),
    fact('010101003', { subcategory: 'Sales only', target: null, actual: 100 })]
  await snapshot(facts)
  await snapshot(facts, 'sales_month')
  return { reader, section, job, save, fact, facts, snapshot, day }
}
