// Shared by the platform tests: an app call names the app version it was
// built against (X-Featherbase-App-Version), as the app's own client does.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeClient, type TestClient } from 'feather-testing-postgres'
import { expect } from 'vitest'
import { discoverPackages } from '../../src/runtime-packages'

export const APP_DIR = process.env.FEATHER_DASH_DIR!
/** The version under test: the app folder's own package.json. */
export const VERSION: string = JSON.parse(readFileSync(resolve(APP_DIR, 'package.json'), 'utf8')).version

export const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': `feather_dash@${VERSION}`, ...init?.headers },
}) }, client.token, client.user)

/** Feather Dash at this version, installed. */
export async function installApp(admin: TestClient) {
  expect(await discoverPackages([APP_DIR])).toEqual([])
  await admin.post('/api/install_app', { name: 'feather_dash' })
}

/** Saves a row of one of the app's Tables. */
export const saveRow = (client: TestClient, table: string, row: Record<string, unknown>) =>
  client.post<Record<string, unknown>>('/api/save_row', { table: table.includes('.') || !/^[a-z_]+$/.test(table) ? table : `feather_dash.${table}`, row })

// The old Tables, as an instance holds them (featherbase's sales-target tests' shapes).
export const OLD_TABLES: [string, Record<string, unknown>[]][] = [
  ['Sales Target Assignment', [
    { column_name: 'employee', column_type: 'Reference', reference_table: 'Person', reqd: true },
    { column_name: 'plant_code', column_type: 'Data', reqd: true },
    { column_name: 'store_label', column_type: 'Data' },
    { column_name: 'material_group', column_type: 'Data', reqd: true },
    { column_name: 'store_subcategory', column_type: 'Data', unique: true, read_only: true },
  ]],
  ['Employee Section Map', ['store_code', 'employee_code', 'subcategory', 'section_name'].map(c => ({ column_name: c, column_type: 'Data' }))],
  ['Section Ownership', ['store_code', 'section_name', 'tl_employee_code', 'dm_employee_code', 'effective_from'].map(c => ({ column_name: c, column_type: 'Data' }))],
  ['Store Manager', ['store_code', 'employee_code', 'full_name', 'email'].map(c => ({ column_name: c, column_type: 'Data' }))],
  ['Section Merchandise Map', ['store_code', 'material_group', 'mch_subcategory', 'section_name'].map(c => ({ column_name: c, column_type: 'Data' }))],
  ['Section Name Alias', ['store_code', 'merch_section_name', 'roster_section_name'].map(c => ({ column_name: c, column_type: 'Data' }))],
]


/** The six old Tables created as an instance holds them, and marked as deciding scope by the instance setup. */
export async function createOldTables(admin: TestClient, markScopeTables: (get: (path: string, init?: RequestInit) => Promise<unknown>) => Promise<unknown>) {
  for (const [name, columns] of OLD_TABLES) await admin.post('/api/table_def', { name, module: 'Store Sections', columns })
  await markScopeTables((path: string, init?: RequestInit) =>
    init?.method === 'PUT' ? admin.fetch(path, init).then(r => r.json()) : admin.get(path))
}
