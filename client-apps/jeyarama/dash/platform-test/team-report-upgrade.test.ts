// #1217: production runs Dash 0.13.1. Upgrading it to this version creates Team Report Manager
// with its grants, the write on the access Table to its own rows only, with nobody's approval
// (#1169's upgrade rule), and logs each grant. A holder then gives a report to their team, and
// their Table grant alone still saves nothing. The 0.13.1 here is this version with #1236 (0.13.17), #1246 (0.13.16), #1245 (0.13.15), #1223 (0.13.14), #1240 (0.13.12), #1223 (0.13.10), #1243 (0.13.9), #1227 (0.13.8), #4588 (0.13.7), #1209 (0.13.6), #1173 (0.13.5), #1217 (0.13.4),
// #1169 (0.13.3) and #1216 (0.13.2) taken out.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { sql } from '../../src/db'
import { discoverPackages } from '../../src/runtime-packages'
import { loadInstalledApps } from '../../src/apps'
import { APP_DIR, TEAM_MANAGER, VERSION, createCoreTables, pinned, revertAddDive, revertPersonIdentity, revertTeamReportGiving, saveRow } from './helpers'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
process.env.MOTHERDUCK_TOKEN = 'made-up-token'

/** Dash 0.13.1 as production runs it. */
async function previousVersion(): Promise<string> {
  const directory = await mkdtemp(resolve(APP_DIR, '..', 'dash-0.13.1-team-'))
  await cp(APP_DIR, directory, { recursive: true })
  const manifest = JSON.parse(await readFile(resolve(directory, 'featherbase.json'), 'utf8'))
  expect(manifest.migrations.pop()).toMatchObject({ id: 'switcher_summary', fromVersion: '0.13.16', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'buyer_section_desks', fromVersion: '0.13.15', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'store_run_by', fromVersion: '0.13.14', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'more_list_closes', fromVersion: '0.13.13', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'report_access_redesign', fromVersion: '0.13.12', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'report_an_issue', fromVersion: '0.13.10', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'manager_area', fromVersion: '0.13.9', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'ends_on_inclusive', fromVersion: '0.13.8', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'one_app_chrome', fromVersion: '0.13.7', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'named_cluster_head', fromVersion: '0.13.6' })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'department_name_follows_sections', fromVersion: '0.13.5' })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'waiting_for_access_grant', fromVersion: '0.13.4' })
  revertTeamReportGiving(manifest)
  expect(manifest.migrations.pop()).toMatchObject({ id: 'report_access_managers_add_dives', fromVersion: '0.13.2' })
  revertAddDive(manifest)
  expect(manifest.migrations.pop()).toMatchObject({ id: 'person_identity', fromVersion: '0.13.1' })
  revertPersonIdentity(manifest)
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(manifest, null, 2))
  await writeFile(resolve(directory, 'package.json'), JSON.stringify({ ...pkg, version: '0.13.1' }))
  return directory
}

const json = { 'content-type': 'application/json' }
const TEAM_GRANTS = [
  { grant: { table: 'dash.report', role: TEAM_MANAGER, operations: { read: '@basic' } } },
  { grant: { table: 'dash.report_bundle', role: TEAM_MANAGER, operations: { read: '@basic' } } },
  { grant: { table: 'dash.report_access', role: TEAM_MANAGER, scope_mode: 'creator', operations: { read: '@basic', create: '@basic', update: '@basic' } } },
]

describe("upgrading production's Dash 0.13.1 to team report giving", () => {
  test('creates Team Report Manager with its grants, own rows only, logged; a holder gives to their team and can’t write directly', async ({ admin, createUser }) => {
    const previous = await previousVersion()
    try {
      const at = (version: string) => ({ 'X-Featherbase-App-Version': `dash@${version}` })
      expect(await discoverPackages([previous])).toEqual([])
      await admin.fetch('/api/install_app', { method: 'POST', headers: { ...json, ...at('0.13.1') }, body: JSON.stringify({ name: 'dash' }) })
      expect(await sql`select 1 from role where row_id = ${TEAM_MANAGER}`).toEqual([])
      expect(await discoverPackages([previous, APP_DIR])).toEqual([])
      await loadInstalledApps()

      const plan = await admin.post<{ planId: string; roles: { create?: string }[]; permissions: { grant?: { role: string } }[]; migrations: { id: string }[] }>('/api/preview_app_upgrade', { name: 'dash', version: VERSION })
      expect([plan.roles, plan.permissions.filter(p => p.grant?.role === TEAM_MANAGER), plan.migrations.map(m => m.id)])
        .toEqual([[{ create: TEAM_MANAGER }], TEAM_GRANTS, ['person_identity', 'report_access_managers_add_dives', 'team_report_giving', 'waiting_for_access_grant', 'department_name_follows_sections', 'named_cluster_head', 'one_app_chrome', 'ends_on_inclusive', 'manager_area', 'report_an_issue', 'report_access_redesign', 'more_list_closes', 'store_run_by', 'buyer_section_desks', 'switcher_summary']])
      await admin.post('/api/upgrade_app', { name: 'dash', version: VERSION, planId: plan.planId })
      await discoverPackages([previous, APP_DIR])
      await loadInstalledApps()
      await admin.post('/api/activate_app_upgrade', { name: 'dash', version: VERSION })

      const [installed] = await sql`select package_version, roles from installed_app where name = 'dash'`
      expect([installed.package_version, (installed.roles as string[]).includes(TEAM_MANAGER)]).toEqual([VERSION, true])
      expect(await sql`select ref_table, operation, scope_mode from permission where role = ${TEAM_MANAGER} order by ref_table, operation`).toEqual([
        { ref_table: 'dash.report', operation: 'read', scope_mode: 'all' },
        { ref_table: 'dash.report_access', operation: 'create', scope_mode: 'creator' },
        { ref_table: 'dash.report_access', operation: 'read', scope_mode: 'creator' },
        { ref_table: 'dash.report_access', operation: 'update', scope_mode: 'creator' },
        { ref_table: 'dash.report_bundle', operation: 'read', scope_mode: 'all' },
      ])
      expect((await sql`select operation from activity_log where operation like ${`app_grant_added dash%${TEAM_MANAGER}%`} order by operation`).map(r => r.operation).sort()).toEqual([
        `app_grant_added dash@${VERSION}: ${TEAM_MANAGER} read on dash.report`,
        `app_grant_added dash@${VERSION}: ${TEAM_MANAGER} read on dash.report_bundle`,
        `app_grant_added dash@${VERSION}: ${TEAM_MANAGER} read, create, update (own rows only) on dash.report_access`,
      ].sort())

      // A holder, after the upgrade: gives a report taking no filter to the one person reporting to them.
      await createCoreTables(admin)
      const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)
      await save('dash.report', { report_key: 'open', report_name: 'Company notices', dive_id: 'made-up-open-dive', filter_shape: 'No filter' })
      const head = await createUser({ email: 'upgrade-team-head@example.test', roles: ['Dash Reader', TEAM_MANAGER] })
      const buyer = await createUser({ email: 'upgrade-team-buyer@example.test', roles: ['Dash Reader'] })
      const giver = await createUser({ email: 'upgrade-team-giver@example.test', roles: ['Dash Reader', 'Report Access Manager'] })
      await save('Employee', { employee_code: 'H1', name: 'Made-up Head', person: head.user, status: 'Current' })
      await save('Employee', { employee_code: 'B1', name: 'Made-up Buyer', person: buyer.user, status: 'Current' })
      await save('Job Assignment', { assignment_id: 'JA-B1', employee: 'B1', job: 'Staff', reports_to: 'H1', starts_on: '2026-01-01' })
      const give = (client: TestClient, payload: Record<string, unknown>) =>
        client.post<{ result: { id: string } }>('/api/app_actions/dash/give_report', { idempotencyKey: crypto.randomUUID(), payload })
      await give(giver, { report: 'open', person: head.user })
      await give(head, { report: 'open', person: buyer.user })
      expect((await buyer.post<{ result: { key: string }[] }>('/api/app_reads/dash/reports', { payload: {} })).result.map(r => r.key)).toEqual(['open'])
      const direct = await head.fetch('/api/save_row', { method: 'POST', headers: json, body: JSON.stringify({ table: 'dash.report_access', row: { report: 'open', person: giver.user } }) })
      expect([direct.status, await direct.text()]).toEqual([417, expect.stringContaining('Give and take away reports on the Report access page')])
    } finally { await rm(previous, { recursive: true, force: true }) }
  })
})
