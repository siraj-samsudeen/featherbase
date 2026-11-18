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
export async function createCoreTables(admin: TestClient, { without = [] as string[] } = {}) {
  for (const table of BASE_TABLES.filter(t => !without.includes(t.name))) await admin.post('/api/table_def', table)
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

/** #1269's 0.13.29 taken out of a manifest: it changes no Table, role or read. */
export function revertReachPrefixes(manifest: { migrations: { id: string }[] }) {
  expect(manifest.migrations.pop()).toMatchObject({ id: 'reach_prefixes', fromVersion: '0.13.28', operations: [] })
}

/** #1218's 0.13.28 taken out of a manifest: no business role Tables, their grants, or the reads of HR titles. Its reads and
 *  actions stay declared: the earlier version shares this build's server module. */
export const SHADOW_TABLES = ['dash.business_role', 'dash.business_role_permission', 'dash.title_map', 'dash.role_assignment']
/** #1218's grants, which this version brings too: the upgrade tests of earlier steps compare without them. */
export const withoutBusinessRoles = <T,>(list: T[]) =>
  list.filter(entry => ![...SHADOW_TABLES, 'dash.access_source', 'dash.switch_over_log'].includes(((entry as Grant & { grant?: { table?: string } }).grant as { table?: string } | undefined)?.table ?? ''))
/** #1277's switch and its log, which 0.13.30 brings. */
export const LIVE_TABLES = ['dash.access_source', 'dash.switch_over_log']
type Revertable = { migrations: { id: string }[]; tables?: { name: string; decides_scope?: boolean; columns?: { column_name: string }[] }[]; permissions?: { table: string }[];
  baseTables?: { read: Record<string, string[]> }; actions?: { tables: string[] }; scopeProvider?: { tables: string[]; unmarkedTables?: string[]; optionalTables?: string[] } }
/** #1277's 0.13.30 taken out of a manifest: business roles decide nothing, no switch. */
export function revertBusinessRolesLive(manifest: Revertable) {
  // 0.13.31 changes no Table, role or read; it comes off first.
  expect(manifest.migrations.pop()).toMatchObject({ id: 'old_grants_one_receiver', fromVersion: '0.13.30', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'business_roles_live', fromVersion: '0.13.29' })
  if (manifest.tables) {
    manifest.tables = manifest.tables.filter(t => !LIVE_TABLES.includes(t.name))
    for (const table of manifest.tables) {
      if (SHADOW_TABLES.includes(table.name)) delete table.decides_scope
      if (table.name === 'dash.report_access') table.columns = table.columns!.filter(c => c.column_name !== 'business_role')
      // #1277's step renames Master Data Steward in the column's description.
      for (const column of (table.columns ?? []) as { column_name: string; description?: string }[])
        if (table.name === 'dash.business_role' && column.column_name === 'by_hand_only') column.description = column.description!.replace('Master Data Manager', 'Master Data Steward').replace('Supplier', 'Vendor')
      // and adds Region to a role's Reaches.
      for (const column of (table.columns ?? []) as { column_name: string; choices?: string; description?: string }[])
        if (table.name === 'dash.business_role' && column.column_name === 'reaches') {
          column.choices = column.choices!.replace('Cluster\nRegion\n', 'Cluster\n')
          column.description = column.description!.replace('store, cluster or region,', 'store or cluster,')
        }
    }
  }
  if (manifest.permissions) manifest.permissions = manifest.permissions.filter(p => !LIVE_TABLES.includes(p.table))
  if (manifest.actions) manifest.actions.tables = manifest.actions.tables.filter(t => !LIVE_TABLES.includes(t))
  const read = manifest.baseTables?.read
  if (read) {
    for (const table of LIVE_TABLES) delete read[table]
    read['dash.report_access'] = read['dash.report_access'].filter(c => c !== 'business_role')
  }
  const provider = manifest.scopeProvider
  if (provider) {
    provider.tables = provider.tables.filter(t => ![...SHADOW_TABLES, 'dash.access_source', 'Designation'].includes(t))
    provider.unmarkedTables = provider.unmarkedTables?.filter(t => t !== 'Designation')
    provider.optionalTables = provider.optionalTables?.filter(t => t !== 'Designation')
  }
}
/** #1277's 0.13.30, then #1269's 0.13.29 under it, then #1218's 0.13.28. */
export function revertBusinessRoles(manifest: Revertable) {
  revertBusinessRolesLive(manifest)
  revertReachPrefixes(manifest)
  expect(manifest.migrations.pop()).toMatchObject({ id: 'business_roles_shadow', fromVersion: '0.13.27' })
  if (manifest.tables) manifest.tables = manifest.tables.filter(t => !SHADOW_TABLES.includes(t.name))
  if (manifest.permissions) manifest.permissions = manifest.permissions.filter(p => !SHADOW_TABLES.includes(p.table))
  if (manifest.actions) manifest.actions.tables = manifest.actions.tables.filter(t => !SHADOW_TABLES.includes(t))
  const read = manifest.baseTables?.read
  if (read) {
    for (const table of [...SHADOW_TABLES, 'Designation']) delete read[table]
    read['Job Assignment'] = read['Job Assignment'].filter(c => c !== 'designation')
    read.Cluster = read.Cluster.filter(c => c !== 'name')
  }
}

/** #1267's 0.13.27 taken out of a manifest: the platform does not ask who people are. Its read
 *  stays declared, since the earlier version shares this build's server module. */
export function revertPeopleDescribe(manifest: { migrations: { id: string }[]; people?: unknown }) {
  expect(manifest.migrations.pop()).toMatchObject({ id: 'people_describe', fromVersion: '0.13.26', operations: [] })
  delete manifest.people
}

/** #1219's 0.13.26 taken out of a manifest. Its Put back action stays declared: the earlier version
 *  shares this build's server module, and the platform refuses handlers it doesn't declare.
 *  #1267's 0.13.27 sits on top of it; it comes off first. */
export function revertMdeReview(manifest: { migrations: { id: string }[]; people?: unknown }) {
  revertPeopleDescribe(manifest)
  expect(manifest.migrations.pop()).toMatchObject({ id: 'mde_review', fromVersion: '0.13.25', operations: [] })
}

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
 * #1222's 0.13.22 taken out of a manifest: no View As Tester, nor its grant, nor View as. Its read
 * stays declared, since the earlier version shares this build's server module.
 */
export function revertViewAs(manifest: { roles: string[]; permissions: { role: string }[]; migrations: { id: string }[]; viewAs?: unknown }) {
  // #1254's 0.13.23 to 0.13.25 change no Table, role or grant; they come off first.
  // #1219's 0.13.26 sits on top of #1254's steps, #1267's 0.13.27 on it, #1218's 0.13.28 on that, #1269's 0.13.29 and #1277's 0.13.30 last; they come off first.
  revertBusinessRoles(manifest as never)
  revertMdeReview(manifest)
  expect(manifest.migrations.pop()).toMatchObject({ id: 'deciders_read_together', fromVersion: '0.13.24', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'holders_read_whole', fromVersion: '0.13.23', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'waiting_reads_fast', fromVersion: '0.13.22', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'view_as', fromVersion: '0.13.21' })
  manifest.roles = manifest.roles.filter(role => role !== VIEW_AS_TESTER)
  manifest.permissions = manifest.permissions.filter(p => p.role !== VIEW_AS_TESTER)
  delete manifest.viewAs
}

/** #1216's 0.13.2 taken out of a manifest: Dash reads no employee code. */
export function revertPersonIdentity(manifest: { baseTables: { read: { Employee: string[] } } }) {
  manifest.baseTables.read.Employee = manifest.baseTables.read.Employee.filter(column => column !== 'employee_code')
}
