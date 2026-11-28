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
export async function createCoreTables(admin: TestClient, { without = [] as string[], withoutSiteKind = false } = {}) {
  for (const table of BASE_TABLES.filter(t => !without.includes(t.name))) {
    // #1280: an instance whose Site has no site_kind or status yet.
    const columns = withoutSiteKind && table.name === 'Site' ? table.columns.filter((c: { column_name: string }) => !['site_kind', 'status'].includes(c.column_name)) : table.columns
    await admin.post('/api/table_def', { row_rule: { kind: 'all' }, ...table, columns })
  }
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
  list.filter(entry => {
    const change = entry as { create?: string; grant?: { table?: string; role?: string }; withdraw?: { table?: string; role?: string } }
    // #1282's grid change log is part of business roles too.
    return ![...SHADOW_TABLES, 'dash.access_source', 'dash.switch_over_log', 'dash.permission_change', 'dash.setup_run', 'dash.access_decision'].includes(change.grant?.table ?? '')
  })
/** #1277's switch and its log, which 0.13.30 brings. */
export const LIVE_TABLES = ['dash.access_source', 'dash.switch_over_log']
/** #1282's 0.13.39: the permission grid's change log. */
export const GRID_LOG = 'dash.permission_change'
type Revertable = { migrations: { id: string }[]; tables?: { name: string; decides_scope?: boolean; columns?: { column_name: string }[] }[]; permissions?: { table: string }[];
  baseTables?: { read: Record<string, string[]> }; actions?: { tables: string[] }; scopeProvider?: { tables: string[]; unmarkedTables?: string[]; optionalTables?: string[]; optionalColumns?: Record<string, string[]> } }
/** #1340's 0.13.40 taken out of a manifest: the four Tables back under Dash, Report grant back to Report access, the
 *  role's two columns back on its list, and no setup runs or access decisions. It comes off before all the others. */
export const RUN_TABLES = ['dash.setup_run', 'dash.access_decision']
export function revertRolesInFeatherbase(manifest: Revertable) {
  // #1459's 0.13.49 (each Table says who reads which of its rows) changes no Table and comes off first. The earlier
  // version written from here still says the rule of each Table it has, or the platform would close them all: the
  // rules are read when the manifest is written, for the Tables it holds by then.
  expect(manifest.migrations.pop()).toMatchObject({ id: 'row_rules', fromVersion: '0.13.48', operations: [] })
  const rules = (manifest as { rowRules?: Record<string, unknown> }).rowRules ?? {}
  Object.defineProperty(manifest, 'rowRules', { enumerable: true, configurable: true,
    get: () => Object.fromEntries(Object.entries(rules).filter(([name]) => manifest.tables?.some(table => table.name === name))) })
  // #1418's 0.13.48 (its one dataset stays a JSON snapshot) changes no Table and comes off first.
  expect(manifest.migrations.pop()).toMatchObject({ id: 'datasets_kept_as_json', fromVersion: '0.13.47', operations: [] })
  // #1423's 0.13.47 (a refused report says why, and is logged) changes no Table and comes off next.
  expect(manifest.migrations.pop()).toMatchObject({ id: 'report_refusals_explained', fromVersion: '0.13.46', operations: [] })
  // #1391's 0.13.46 (which report and Dive failed, and a lost connection told apart) changes no Table and comes off next.
  expect(manifest.migrations.pop()).toMatchObject({ id: 'dive_failure_detail', fromVersion: '0.13.45', operations: [] })
  const step = manifest.migrations.pop() as unknown as { operations: { kind: string; table: string; column?: string; from?: { label?: string } }[] }
  expect(step).toMatchObject({ id: 'business_roles_in_featherbase', fromVersion: '0.13.44', toVersion: '0.13.45' })
  // Each column the step relabelled reads as it did before it.
  const relabelled = new Map(step.operations.filter(o => o.kind === 'alterColumn' && o.from?.label).map(o => [`${o.table}/${o.column}`, o.from!.label!]))
  if (manifest.tables) manifest.tables = manifest.tables.filter(t => !RUN_TABLES.includes(t.name)).map(t => {
    const table = { ...t } as typeof t & { module?: string; label?: string; columns?: { column_name: string; in_list_view?: boolean; label?: string }[] }
    if (table.module === 'People') table.module = 'Dash'
    const label = ({ 'dash.business_role': 'Business role', 'dash.title_map': 'Title map', 'dash.role_assignment': 'Role assignment', 'dash.report_access': 'Report access',
      'dash.switch_over_log': 'Business roles log', 'dash.business_role_permission': 'Business role permission', 'dash.permission_change': 'Permission change',
      'dash.access_source': 'Dash access source' } as Record<string, string>)[table.name]
    if (label) table.label = label
    if (table.name === 'dash.switch_over_log') table.columns = table.columns!.filter(c => c.column_name !== 'setup_run')
    if (table.name === 'dash.business_role') table.columns = table.columns!.map(c => (['description', 'by_hand_only'].includes(c.column_name) ? { ...c, in_list_view: true }
      : c))
    if (table.columns) table.columns = table.columns.map(c => (relabelled.has(`${table.name}/${c.column_name}`) ? { ...c, label: relabelled.get(`${table.name}/${c.column_name}`) } : c))
    return table
  })
  if (manifest.permissions) manifest.permissions = manifest.permissions.filter(p => !RUN_TABLES.includes(p.table))
  if (manifest.actions) manifest.actions.tables = manifest.actions.tables.filter(t => !RUN_TABLES.includes(t))
  const read = manifest.baseTables?.read
  if (read) {
    delete read['dash.access_decision']
    if (read['dash.switch_over_log']) read['dash.switch_over_log'] = read['dash.switch_over_log'].filter(c => c !== 'setup_run')
  }
  delete (manifest as { records?: unknown }).records
}
/** #1280's 0.13.33 taken out of a manifest: Dash reads no Site kind or status. #1277's 0.13.34 changes no Table and comes off first. */
export function revertSiteKind(manifest: Revertable) {
  revertRolesInFeatherbase(manifest)
  // #1366's 0.13.44 (no sales copies) only re-describes quick_view; it comes off next, and the description goes back.
  const noCopies = manifest.migrations.pop() as unknown as { id: string; operations: { kind: string; column: string; from: { description: string } }[] }
  expect(noCopies).toMatchObject({ id: 'no_sales_copies', fromVersion: '0.13.43', operations: [{ kind: 'alterColumn', table: 'dash.report', column: 'quick_view' }] })
  if (manifest.tables) manifest.tables = manifest.tables.map(t => (t.name === 'dash.report'
    ? { ...t, columns: t.columns!.map(c => (c.column_name === 'quick_view' ? { ...c, description: noCopies.operations[0].from.description } : c)) } : t))
  // #1282's 0.13.43 (the worked-out sections declared as people.sections) changes no Table and comes off next.
  expect(manifest.migrations.pop()).toMatchObject({ id: 'people_sections', fromVersion: '0.13.42', operations: [] })
  // #1345's 0.13.42 (each job's business role and a leaver's leaving day, for the Person Label) changes no Table and comes off after it.
  expect(manifest.migrations.pop()).toMatchObject({ id: 'person_label', fromVersion: '0.13.41', operations: [] })
  // The 0.13.41 hotfix (every report read through Dash's own documents) changes no Table and comes off next.
  expect(manifest.migrations.pop()).toMatchObject({ id: 'every_report_own_read', fromVersion: '0.13.40', operations: [] })
  // #1282's 0.13.40 (the Lens's worked-out sections) changes no Table and comes off next.
  expect(manifest.migrations.pop()).toMatchObject({ id: 'worked_out_sections', fromVersion: '0.13.39', operations: [] })
  // #1282's 0.13.39 (the permission grid): a permission's removed mark and the grid's change log; it comes off next.
  expect(manifest.migrations.pop()).toMatchObject({ id: 'permission_grid', fromVersion: '0.13.38',
    operations: [{ kind: 'addColumn', table: 'dash.business_role_permission', column: { column_name: 'removed' } }, { kind: 'addColumn', table: 'dash.business_role_permission', column: { column_name: 'permission_key' } }, { kind: 'addTable', table: { name: GRID_LOG } }] })
  if (manifest.tables) manifest.tables = manifest.tables.filter(t => t.name !== GRID_LOG).map(t => (t.name === 'dash.business_role_permission'
    ? { ...t, columns: t.columns!.filter(c => c.column_name !== 'removed' && c.column_name !== 'permission_key') } : t))
  if (manifest.permissions) manifest.permissions = manifest.permissions.filter(p => p.table !== GRID_LOG)
  if (manifest.actions) manifest.actions.tables = manifest.actions.tables.filter(t => t !== GRID_LOG)
  const permissionRead = manifest.baseTables?.read['dash.business_role_permission']
  if (permissionRead) manifest.baseTables!.read['dash.business_role_permission'] = permissionRead.filter(c => c !== 'removed' && c !== 'updated_at')
  // #1282's 0.13.38 (the area picker), #1313's 0.13.37 (Report access dates) and #1282's 0.13.35 and 0.13.36 (the Map's Why) change no Table and come off next.
  expect(manifest.migrations.pop()).toMatchObject({ id: 'area_picker', fromVersion: '0.13.37', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'report_access_days_in_india', fromVersion: '0.13.36', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'why_app_levels_merged', fromVersion: '0.13.35', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'why_on_the_map', fromVersion: '0.13.34', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'division_head_and_visual_merchandising', fromVersion: '0.13.33', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'site_kind', fromVersion: '0.13.32', operations: [] })
  const read = manifest.baseTables?.read
  if (read?.Site) read.Site = read.Site.filter(c => c !== 'site_kind' && c !== 'status')
  if (manifest.scopeProvider) delete manifest.scopeProvider.optionalColumns
}
/** #1277's 0.13.30 taken out of a manifest: business roles decide nothing, no switch. #1280's 0.13.33 comes off first. */
export function revertBusinessRolesLive(manifest: Revertable) {
  revertSiteKind(manifest)
  // 0.13.32 and 0.13.31 change no Table, role or read; they come off first.
  expect(manifest.migrations.pop()).toMatchObject({ id: 'every_report_and_bulk_comparison', fromVersion: '0.13.31', operations: [] })
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
