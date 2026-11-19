// rama_dw #4588: a rehearsal of the deploy on a database shaped like production on 16-Nov-2026: Cluster's
// cluster_manager is a text column, empty on all three clusters; Operating Region has no region_head; and
// dash.linked_tables does not list Cluster yet. Upgrading Dash from the version before this one must not
// lock anyone out (the scope provider fails closed on a missing Table or column): the instance stays healthy,
// a Dash Reader still opens Dash, and a Cluster Manager by job and site still gets their cluster's stores.
// Naming a head in cluster_manager (their Employee id, as text) then gives them that cluster whole.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { discoverPackages } from '../../src/runtime-packages'
import { loadInstalledApps } from '../../src/apps'
import { runHealthChecks } from '../../src/instance-health'
import { APP_DIR, VERSION, pinned, saveRow, revertViewAs, VIEW_AS_TESTER } from './helpers'
// @ts-expect-error a plain .mjs module, copied in beside this file by the runner
import { BASE_TABLES, LINKED_TABLES } from './base-tables.mjs'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
process.env.MOTHERDUCK_TOKEN = 'made-up-token'

/** The version before this one, as production runs it: no named cluster head, and Cluster not read. */
async function previousVersion(): Promise<{ directory: string; version: string }> {
  const directory = await mkdtemp(resolve(APP_DIR, '..', 'dash-before-cluster-head-'))
  await cp(APP_DIR, directory, { recursive: true })
  const manifest = JSON.parse(await readFile(resolve(directory, 'featherbase.json'), 'utf8'))
  // #1227's 0.13.8 changes no Table: the version before named_cluster_head is 0.13.6 with both steps off.
  // #1243's 0.13.9 changes no Table either; it comes off first.
  // #1223's 0.13.10 changes no Table either; it comes off first.
  // #1240's 0.13.12 changes no Table either; it comes off first.
  // #1225's 0.13.13 changes no Table either; it comes off first.
  // #1223's 0.13.14 changes no Table either; it comes off first.
  // #1245's 0.13.15 changes no Table either; it comes off first.
  // #1246's 0.13.16 and 0.13.17 change no Table either; they come off first.
  // #1236's 0.13.19 changes no Table either; it comes off first.
  // #1248's 0.13.21 changes no Table either; it comes off first.
  revertViewAs(manifest)
  expect(manifest.migrations.pop()).toMatchObject({ id: 'sidebar_icon_rail', toVersion: '0.13.21', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'switcher_summary', toVersion: '0.13.19', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'buyer_section_moves', toVersion: '0.13.17', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'buyer_section_desks', toVersion: '0.13.16', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'store_run_by', toVersion: '0.13.15', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'more_list_closes', toVersion: '0.13.14', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'report_access_redesign', toVersion: '0.13.13', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'report_an_issue', toVersion: '0.13.12', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'manager_area', toVersion: '0.13.10', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'ends_on_inclusive', toVersion: '0.13.9', operations: [] })
  expect(manifest.migrations.pop()).toMatchObject({ id: 'one_app_chrome', toVersion: '0.13.8', operations: [] })
  const step = manifest.migrations.pop()
  expect(step).toMatchObject({ id: 'named_cluster_head', toVersion: '0.13.7', operations: [] })
  const notCluster = (tables: string[]) => tables.filter(table => table !== 'Cluster')
  manifest.scopeProvider.tables = notCluster(manifest.scopeProvider.tables)
  manifest.scopeProvider.unmarkedTables = notCluster(manifest.scopeProvider.unmarkedTables)
  delete manifest.baseTables.read.Cluster
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(manifest, null, 2))
  await writeFile(resolve(directory, 'package.json'), JSON.stringify({ ...pkg, version: step.fromVersion }))
  return { directory, version: step.fromVersion }
}

describe("deploying the named cluster head to an instance shaped like production", () => {
  test('nobody is locked out, a Cluster Manager by job keeps their stores, and a named head gets theirs', async ({ admin, createUser }) => {
    const { directory: previous, version: before } = await previousVersion()
    try {
      // Production's shape: cluster_manager is text; Operating Region has no region_head.
      expect(BASE_TABLES.find((t: { name: string }) => t.name === 'Cluster').columns).toContainEqual({ column_name: 'cluster_manager', column_type: 'Data' })
      expect(BASE_TABLES.find((t: { name: string }) => t.name === 'Operating Region').columns.map((c: { column_name: string }) => c.column_name)).toEqual(['region'])
      for (const table of BASE_TABLES) await admin.post('/api/table_def', table)
      const linked = async (tables: string[]) => {
        const current = await admin.fetch(`/api/table/${encodeURIComponent('App Setting')}/dash.linked_tables`)
        const updated_at = current.ok ? (await current.json()).updated_at : undefined
        await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'dash.linked_tables', value: JSON.stringify(tables), ...(updated_at ? { updated_at } : {}) } })
      }

      const at = (version: string) => ({ 'X-Featherbase-App-Version': `dash@${version}` })
      expect(await discoverPackages([previous])).toEqual([])
      await admin.fetch('/api/install_app', { method: 'POST', headers: { 'content-type': 'application/json', ...at(before) }, body: JSON.stringify({ name: 'dash' }) })
      await linked(LINKED_TABLES.filter((table: string) => table !== 'Cluster'))

      const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)
      for (const region of ['East', 'West']) await save('Operating Region', { region })
      // Three clusters, as production has, none naming a head.
      for (const [code, name] of [['KL1', 'Cluster One'], ['KL2', 'Cluster Two'], ['KL3', 'Cluster Three']]) await save('Cluster', { code, name })
      for (const [code, name, cluster] of [['LKS', 'Lakeside', 'KL1'], ['HIL', 'Hillview', 'KL1'], ['RIV', 'Riverside', 'KL2']])
        await save('Site', { code, name, is_store: true, cluster, operating_region: 'East' })
      await save('Site', { code: 'HOF', name: 'Head Office', is_store: false, operating_region: 'East' })
      for (const [plant_code, site] of [['9901', 'LKS'], ['9902', 'HIL'], ['9903', 'RIV']]) await save('Plant', { plant_code, plant_type: 'Store', site })
      const staff = async (code: string, roles: string[], job?: { job: string; site: string }) => {
        const person = await createUser({ email: `cluster-head-${code}@example.test`, roles })
        await save('Employee', { employee_code: code, name: `Made-up ${code}`, person: person.user, status: 'Current' })
        if (job) await save('Job Assignment', { assignment_id: `JA-${code}`, employee: code, starts_on: '2026-01-01', ...job })
        return person
      }
      const storeManager = await staff('501', ['Dash Reader'], { job: 'Store Manager', site: 'LKS' })
      const clusterManager = await staff('502', ['Dash Reader'], { job: 'Cluster Manager', site: 'HIL' })
      const headOffice = await staff('503', ['Dash Reader'], { job: 'Cluster Manager', site: 'HOF' })

      // The deploy: the app upgrades to this version.
      expect(await discoverPackages([previous, APP_DIR])).toEqual([])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string; roles: unknown[]; permissions: { grant?: { role: string } }[]; migrations: { id: string }[] }>('/api/preview_app_upgrade', { name: 'dash', version: VERSION })
      expect(plan.migrations.map(m => m.id)).toEqual(['named_cluster_head', 'one_app_chrome', 'ends_on_inclusive', 'manager_area', 'report_an_issue', 'report_access_redesign', 'more_list_closes', 'store_run_by', 'buyer_section_desks', 'buyer_section_moves', 'switcher_summary', 'sidebar_icon_rail', 'view_as', 'waiting_reads_fast', 'holders_read_whole', 'deciders_read_together', 'mde_review', 'people_describe', 'business_roles_shadow', 'reach_prefixes', 'business_roles_live', 'old_grants_one_receiver', 'every_report_and_bulk_comparison', 'site_kind', 'division_head_and_visual_merchandising', 'why_on_the_map', 'why_app_levels_merged', 'report_access_days_in_india', 'area_picker', 'permission_grid', 'business_roles_in_featherbase'])
      // #1222: the upgrade creates View As Tester with one grant, the read of the reports list.
      expect([plan.roles, plan.permissions.filter(p => p.grant?.role === VIEW_AS_TESTER)]).toEqual([[{ create: VIEW_AS_TESTER }],
        [{ grant: { table: 'dash.report', role: VIEW_AS_TESTER, operations: { read: '@basic' } } }]])
      await admin.post('/api/upgrade_app', { name: 'dash', version: VERSION, planId: plan.planId })
      await discoverPackages([previous, APP_DIR])
      await loadInstalledApps()
      await admin.post('/api/activate_app_upgrade', { name: 'dash', version: VERSION })

      const stores = async (person: TestClient) => {
        // The platform's own "why does this person see nothing" answer: each place by its label (a whole store is its plant).
        const scope = await admin.get<{ places: { label: string; filters: string[] }[] }>(`/api/people/${person.user}/scope?app=dash`)
        return scope.places.map(place => place.label).sort()
      }
      const opens = (person: TestClient) => person.post<{ result: unknown }>('/api/app_reads/dash/can_open', { payload: {} }).then(a => a.result)
      const healthy = async () => (await runHealthChecks()).find(check => check.key === 'scope-provider-tables:dash')

      // Before and after the deploy re-applies dash.linked_tables with Cluster in it.
      for (const listed of [false, true]) {
        if (listed) await linked(LINKED_TABLES)
        expect(await healthy()).toMatchObject({ ok: true })
        expect(await opens(storeManager)).toBe(true)
        expect(await stores(storeManager)).toEqual(['9901'])
        expect(await stores(clusterManager)).toEqual(['9901', '9902'])
        expect(await stores(headOffice)).toEqual([])
      }

      // A head named in cluster_manager, by Employee id as text, gets that cluster whole.
      const cluster = await admin.get<{ updated_at: string }>('/api/table/Cluster/KL2')
      await save('Cluster', { row_id: 'KL2', updated_at: cluster.updated_at, cluster_manager: '503' })
      expect(await stores(headOffice)).toEqual(['9903'])
    } finally { await rm(previous, { recursive: true, force: true }) }
  })
})
