// #1169: production runs Dash 0.13.1. Upgrading it gives Report Access Manager the right to create
// reports, with nobody's approval, and logs it; a Report Access Manager then adds a Dive and gives
// it at once. A reader can do neither. The 0.13.1 here is this version with #1246 (0.13.16 and 0.13.17), #1245 (0.13.15), #1223 (0.13.14), #1240 (0.13.12), #1223 (0.13.10), #1243 (0.13.9), #1227 (0.13.8), #4588 (0.13.7), #1209 (0.13.6), #1173 (0.13.5), #1169 (0.13.3) and #1216 (0.13.2) taken out.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { sql } from '../../src/db'
import { discoverPackages } from '../../src/runtime-packages'
import { loadInstalledApps } from '../../src/apps'
import { APP_DIR, TEAM_MANAGER, VERSION, createCoreTables, pinned, revertAddDive, revertPersonIdentity, revertTeamReportGiving, withoutTeamManager, revertViewAs, VIEW_AS_TESTER, withoutViewAsTester, withoutBusinessRoles, SHADOW_TABLES, LIVE_TABLES, GRID_LOG } from './helpers'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
process.env.MOTHERDUCK_TOKEN = 'made-up-token'
const MANAGER = 'Report Access Manager'
const DIVE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** Dash 0.13.1 as production runs it. */
async function previousVersion(): Promise<string> {
  const directory = await mkdtemp(resolve(APP_DIR, '..', 'dash-0.13.1-'))
  await cp(APP_DIR, directory, { recursive: true })
  const manifest = JSON.parse(await readFile(resolve(directory, 'featherbase.json'), 'utf8'))
  revertViewAs(manifest)
  expect(manifest.migrations.pop()).toMatchObject({ id: 'sidebar_icon_rail', fromVersion: '0.13.19', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'switcher_summary', fromVersion: '0.13.17', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'buyer_section_moves', fromVersion: '0.13.16', operations: [] })
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

const action = (client: TestClient, name: string, payload: Record<string, unknown>) =>
  client.post<{ result: Record<string, unknown> }>(`/api/app_actions/dash/${name}`, { idempotencyKey: crypto.randomUUID(), payload })

describe("upgrading production's Dash 0.13.1", () => {
  test('lets a Report Access Manager create reports, logged, and add a Dive a reader then opens', async ({ admin, createUser }) => {
    const previous = await previousVersion()
    try {
      const at = (version: string) => ({ 'X-Featherbase-App-Version': `dash@${version}` })
      expect(await discoverPackages([previous])).toEqual([])
      await admin.fetch('/api/install_app', { method: 'POST', headers: { 'content-type': 'application/json', ...at('0.13.1') }, body: JSON.stringify({ name: 'dash' }) })
      expect(await sql`select operation from permission where role = ${MANAGER} and ref_table = 'dash.report'`).toEqual([{ operation: 'read' }])
      expect(await discoverPackages([previous, APP_DIR])).toEqual([])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string; permissions: unknown; migrations: { id: string }[] }>('/api/preview_app_upgrade', { name: 'dash', version: VERSION })
      // #1217's role and grants come with this version too; team-report-upgrade.test.ts checks them.
      expect([withoutBusinessRoles(withoutViewAsTester(withoutTeamManager(plan.permissions as never[]))), plan.migrations.map(m => m.id)]).toEqual([[
        { withdraw: { table: 'dash.report', role: MANAGER, operations: { read: '@basic' } } },
        { grant: { table: 'dash.report', role: MANAGER, operations: { read: '@basic', create: '@basic' } } }],
      ['person_identity', 'report_access_managers_add_dives', 'team_report_giving', 'waiting_for_access_grant', 'department_name_follows_sections', 'named_cluster_head', 'one_app_chrome', 'ends_on_inclusive', 'manager_area', 'report_an_issue', 'report_access_redesign', 'more_list_closes', 'store_run_by', 'buyer_section_desks', 'buyer_section_moves', 'switcher_summary', 'sidebar_icon_rail', 'view_as', 'waiting_reads_fast', 'holders_read_whole', 'deciders_read_together', 'mde_review', 'people_describe', 'business_roles_shadow', 'reach_prefixes', 'business_roles_live', 'old_grants_one_receiver', 'every_report_and_bulk_comparison', 'site_kind', 'division_head_and_visual_merchandising', 'why_on_the_map', 'why_app_levels_merged', 'report_access_days_in_india', 'area_picker', 'permission_grid', 'worked_out_sections', 'every_report_own_read', 'person_label', 'people_sections', 'no_sales_copies']])
      await admin.post('/api/upgrade_app', { name: 'dash', version: VERSION, planId: plan.planId })
      await discoverPackages([previous, APP_DIR])
      await loadInstalledApps()
      await admin.post('/api/activate_app_upgrade', { name: 'dash', version: VERSION })
      expect((await sql`select operation from permission where role = ${MANAGER} and ref_table = 'dash.report' order by operation`).map(r => r.operation)).toEqual(['create', 'read'])
      expect((await sql`select operation from activity_log where operation like 'app_grant_added dash%' and operation not like ${`%${TEAM_MANAGER}%`} and operation not like ${`%${VIEW_AS_TESTER}%`}`).map(r => r.operation)
        // #1218's grants on its four Tables come with this version too; business-roles.test.ts checks them.
        // #1282's grid change log comes with it as well.
        .filter(operation => ![...SHADOW_TABLES, ...LIVE_TABLES, GRID_LOG].some(table => operation.endsWith(` on ${table}`))))
        .toEqual([`app_grant_added dash@${VERSION}: ${MANAGER} read, create on dash.report`])

      await createCoreTables(admin)
      const manager = await createUser({ email: 'add-dive-manager@example.test', roles: ['Dash Reader', MANAGER] })
      const reader = await createUser({ email: 'add-dive-reader@example.test', roles: ['Dash Reader'] })
      expect((await action(manager, 'add_report', { dive_id: DIVE, name: 'Floor stock' })).result).toEqual({ key: 'floor-stock', name: 'Floor stock' })
      expect(await sql`select report_key, report_name, dive_id, filter_shape from dash.report where report_key = 'floor-stock'`)
        .toEqual([{ report_key: 'floor-stock', report_name: 'Floor stock', dive_id: DIVE, filter_shape: 'No filter' }])
      // The review's hole (#1169): a manager's own save of a second report on a Dive already in
      // Dash, taking no filter, would give every store's figures. Refused on the generic path too.
      await expect(manager.post('/api/table/dash.report', { report_key: 'floor-again', report_name: 'Floor again', dive_id: DIVE.toUpperCase(), filter_shape: 'No filter' }))
        .rejects.toMatchObject({ message: expect.stringContaining('That Dive is already in Dash as Floor stock') })
      await action(manager, 'give_report', { report: 'floor-stock', person: reader.user })
      expect((await reader.post<{ result: { key: string }[] }>('/api/app_reads/dash/reports', { payload: {} })).result.map(r => r.key)).toEqual(['floor-stock'])

      await expect(action(reader, 'add_report', { dive_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Mine' }))
        .rejects.toMatchObject({ message: expect.stringContaining('Only a Report Access Manager or a System Manager') })
      await expect(reader.post('/api/app_reads/dash/dive_choices', { payload: {} }))
        .rejects.toMatchObject({ message: expect.stringContaining('Only a Report Access Manager or a System Manager can add reports') })
    } finally { await rm(previous, { recursive: true, force: true }) }
  })
})
