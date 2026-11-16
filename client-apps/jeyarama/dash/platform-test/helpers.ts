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

/**
 * #1169's 0.13.3 taken out of a manifest, for the upgrade tests' earlier versions: a Report Access
 * Manager reads reports and creates none. Its read, action and dataset stay declared, since the
 * earlier version shares this build's server module; only the grant differs from production's.
 */
export function revertAddDive(manifest: { permissions: Record<string, unknown>[] }) {
  const grant = manifest.permissions.find(p => p.table === 'dash.report' && p.role === 'Report Access Manager')!
  delete grant.operations
  grant.can_read = true
}

/** #1217's role, which a later step brings: the upgrade tests of earlier steps compare without it. */
export const TEAM_MANAGER = 'Team Report Manager'
type Grant = { grant?: { role: string }; withdraw?: { role: string } }
export const withoutTeamManager = <T extends Grant | { create?: string }>(list: T[]) =>
  list.filter(entry => ('create' in entry ? entry.create : ((entry as Grant).grant ?? (entry as Grant).withdraw)?.role) !== TEAM_MANAGER)

/** #1217's 0.13.4 taken out of a manifest: no Team Report Manager, nor its grants. */
export function revertTeamReportGiving(manifest: { roles: string[]; permissions: { role: string }[]; migrations: { id: string }[] }) {
  expect(manifest.migrations.pop()).toMatchObject({ id: 'team_report_giving', fromVersion: '0.13.3' })
  manifest.roles = manifest.roles.filter(role => role !== TEAM_MANAGER)
  manifest.permissions = manifest.permissions.filter(p => p.role !== TEAM_MANAGER)
}

/** #1222's role, which a later step brings: the upgrade tests of earlier steps compare without it. */
export const VIEW_AS_TESTER = 'View As Tester'
export const withoutViewAsTester = <T extends Grant | { create?: string }>(list: T[]) =>
  list.filter(entry => ('create' in entry ? entry.create : ((entry as Grant).grant ?? (entry as Grant).withdraw)?.role) !== VIEW_AS_TESTER)

/**
 * #1222's 0.13.8 taken out of a manifest: no View As Tester, nor its grant, nor View as. Its read
 * stays declared, since the earlier version shares this build's server module.
 */
export function revertViewAs(manifest: { roles: string[]; permissions: { role: string }[]; migrations: { id: string }[]; viewAs?: unknown }) {
  expect(manifest.migrations.pop()).toMatchObject({ id: 'view_as', fromVersion: '0.13.7' })
  manifest.roles = manifest.roles.filter(role => role !== VIEW_AS_TESTER)
  manifest.permissions = manifest.permissions.filter(p => p.role !== VIEW_AS_TESTER)
  delete manifest.viewAs
}

/** #1216's 0.13.2 taken out of a manifest: Dash reads no employee code. */
export function revertPersonIdentity(manifest: { baseTables: { read: { Employee: string[] } } }) {
  manifest.baseTables.read.Employee = manifest.baseTables.read.Employee.filter(column => column !== 'employee_code')
}
