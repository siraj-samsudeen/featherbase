// Shared by the platform tests: an app call names the app version it was
// built against (X-Featherbase-App-Version), as the app's own client does.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeClient, type TestClient } from 'feather-testing-postgres'
import { expect } from 'vitest'
import { discoverPackages } from '../../src/runtime-packages'
import { ACCESS_ROWS, BASE_TABLES, LINKED_TABLES, REPORT_ROWS } from './base-tables.mjs'
// @ts-expect-error a plain .mjs module, copied in beside this file by the runner

export const APP_DIR = process.env.DASH_DIR!
/** The version under test: the app folder's own package.json. */
export const VERSION: string = JSON.parse(readFileSync(resolve(APP_DIR, 'package.json'), 'utf8')).version

export const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': `dash@${VERSION}`, ...init?.headers },
}) }, client.token, client.user)

/** Dash at this version, installed. */
export async function installApp(admin: TestClient) {
  expect(await discoverPackages([APP_DIR])).toEqual([])
  await admin.post('/api/install_app', { name: 'dash' })
}

/** Saves a row of one of the app's Tables. */
export const saveRow = (client: TestClient, table: string, row: Record<string, unknown>) =>
  client.post<Record<string, unknown>>('/api/save_row', { table: table.includes('.') || !/^[a-z_]+$/.test(table) ? table : `dash.${table}`, row })

/** A request as the instance setup step makes one: the parsed body, or a throw on an error status. */
const asAdmin = (admin: TestClient) => (path: string, init?: RequestInit) =>
  init?.method === 'PUT' ? admin.fetch(path, init).then(r => r.json()) : admin.get(path)

/** The core Tables created and listed in `dash.linked_tables`. */
export async function createCoreTables(admin: TestClient) {
  for (const table of BASE_TABLES) await admin.post('/api/table_def', table)
  await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'dash.linked_tables', value: JSON.stringify(LINKED_TABLES) } })
}

export { ACCESS_ROWS, REPORT_ROWS }
