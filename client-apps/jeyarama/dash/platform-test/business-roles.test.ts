// #1218 (option A): business roles in shadow. Upgrading from main's 0.13.27 adds the four Tables and the
// Report Access Manager's grants on them, with nobody's approval; a manager writes the starting
// roles and gives a role by hand, and a reader's reports and front door stay as they were.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { sql } from '../../src/db'
import { discoverPackages } from '../../src/runtime-packages'
import { loadInstalledApps } from '../../src/apps'
import { APP_DIR, SHADOW_TABLES, VERSION, createCoreTables, pinned, revertBusinessRoles, saveRow } from './helpers'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
process.env.MOTHERDUCK_TOKEN = 'made-up-token'
const MANAGER = 'Report Access Manager'

async function previousVersion(): Promise<string> {
  const directory = await mkdtemp(resolve(APP_DIR, '..', 'dash-0.13.27-'))
  await cp(APP_DIR, directory, { recursive: true })
  const manifest = JSON.parse(await readFile(resolve(directory, 'featherbase.json'), 'utf8'))
  revertBusinessRoles(manifest)
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(manifest, null, 2))
  await writeFile(resolve(directory, 'package.json'), JSON.stringify({ ...pkg, version: '0.13.27' }))
  return directory
}

describe('business roles in shadow', () => {
  test('arrive as four Tables a Report Access Manager edits, and change no reader\'s reports', async ({ admin, createUser }) => {
    const previous = await previousVersion()
    try {
      expect(await discoverPackages([previous])).toEqual([])
      await admin.fetch('/api/install_app', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Featherbase-App-Version': 'dash@0.13.27' }, body: JSON.stringify({ name: 'dash' }) })
      expect(await discoverPackages([previous, APP_DIR])).toEqual([])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string; migrations: { id: string }[] }>('/api/preview_app_upgrade', { name: 'dash', version: VERSION })
      expect(plan.migrations.map(m => m.id)).toEqual(['business_roles_shadow', 'reach_prefixes', 'business_roles_live', 'old_grants_one_receiver', 'every_report_and_bulk_comparison', 'site_kind', 'division_head_and_visual_merchandising', 'why_on_the_map', 'why_app_levels_merged'])
      await admin.post('/api/upgrade_app', { name: 'dash', version: VERSION, planId: plan.planId })
      await discoverPackages([previous, APP_DIR])
      await loadInstalledApps()
      await admin.post('/api/activate_app_upgrade', { name: 'dash', version: VERSION })
      expect((await sql`select name from table_def where name in ${sql(SHADOW_TABLES)} order by name`).map(r => r.name)).toEqual([...SHADOW_TABLES].sort())
      await createCoreTables(admin)
      const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)
      await save('dash.report', { report_key: 'open', report_name: 'Company notices', dive_id: 'made-up-open-dive', filter_shape: 'No filter' })
      await save('dash.report_access', { report: 'open', role: 'Dash Reader' })
      expect((await sql`select distinct ref_table from permission where role = ${MANAGER} and ref_table in ${sql(SHADOW_TABLES)} order by ref_table`).map(r => r.ref_table)).toEqual([...SHADOW_TABLES].sort())

      const reader = await createUser({ email: 'shadow-reader@example.test', roles: ['Dash Reader'] })
      await save('Employee', { employee_code: 'R1', name: 'Made-up Reader', person: reader.user, status: 'Current' })
      await save('Job Assignment', { assignment_id: 'JA-R1', employee: 'R1', job: 'Staff', starts_on: '2026-01-01' })
      // What today's access answers for the reader: their reports, the front door, and why their job reaches nothing.
      const todays = async () => {
        const answers: unknown[] = []
        for (const name of ['reports', 'can_open', 'reach_problem']) answers.push((await reader.post<{ result: unknown }>(`/api/app_reads/dash/${name}`, { payload: {} })).result)
        return answers
      }
      const scope = () => admin.get(`/api/people/${encodeURIComponent(reader.user)}/scope?app=dash`)
      const before = await todays()
      const scopeBefore = await scope()
      expect((before[0] as { key: string }[]).map(r => r.key)).toEqual(['open'])
      // #1277: the business role Tables decide scope, so only a System Manager writes them; a Report Access Manager alone is refused.
      const accessManager = await createUser({ email: 'shadow-access-manager@example.test', roles: ['Dash Reader', MANAGER] })
      const refusedWrite = await accessManager.fetch('/api/app_actions/dash/add_starting_roles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), payload: {} }) })
      expect(refusedWrite.status).toBeGreaterThanOrEqual(400)
      const manager = await createUser({ email: 'shadow-manager@example.test', roles: ['Dash Reader', MANAGER, 'System Manager'] })
      const act = (name: string, payload: Record<string, unknown>) => manager.post<{ result: unknown }>(`/api/app_actions/dash/${name}`, { idempotencyKey: crypto.randomUUID(), payload })
      await act('add_starting_roles', {})
      const page = (await manager.post<{ result: { roles: { id: string; name: string }[] } }>('/api/app_reads/dash/business_roles', { payload: {} })).result
      expect(page.roles).toHaveLength(18)
      const storeManager = page.roles.find(r => r.name === 'Store Manager')!.id
      await act('give_role', { person: reader.user, change: 'Correct', role: storeManager, reason: 'Runs the store' })
      // A role that would reach every store in the new model, and a mapping that changes the reader's title: neither may leak into today.
      await act('give_role', { person: reader.user, change: 'Also give', role: page.roles.find(r => r.name === 'Owner Director')!.id })
      await act('map_title', { title: 'Staff', role: page.roles.find(r => r.name === 'Head Office')!.id })
      const explained = (await manager.post<{ result: { roles: { name: string; source: string }[] } }>('/api/app_reads/dash/explain_person', { payload: { person: reader.user } })).result
      expect(explained.roles.map(r => [r.name, r.source])).toEqual([['Store Manager', 'Corrected by hand'], ['Owner Director', 'Also given by hand']])
      // #1277: Owner Director views every report; the whole-company comparison, with everyone's roles read at once, agrees.
      // #1282: the platform Map's Why, through Dash's own reads: offered to this manager, and the chain from the same reasoning.
      expect((await manager.post<{ result: unknown }>('/api/app_reads/dash/why_access_offered', { payload: { table: 'Person', row: reader.user } })).result).toBe(true)
      const why = (await manager.post<{ result: { version: number; columns: { heading: string }[] } }>('/api/app_reads/dash/why_access', { payload: { table: 'Person', row: reader.user } })).result
      expect([why.version, why.columns[0]!.heading]).toEqual([1, 'Person'])
      expect((explained as unknown as { reports: { key: string; why: string[] }[] }).reports).toEqual([{ key: 'open', name: 'Company notices', why: ['Every report, through Owner Director'], roles: [expect.any(String)], direct: false }])
      const changes = (await manager.post<{ result: { people: number; changed: number; groups: { people: { person: string }[] }[] } }>('/api/app_reads/dash/access_changes', { payload: {} })).result
      expect([changes.people, changes.groups.flatMap(g => g.people).map(p => p.person)]).toEqual([1, []])

      expect(await todays()).toEqual(before)
      expect(await scope()).toEqual(scopeBefore)
      const refused = await reader.fetch('/api/app_reads/dash/business_roles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: {} }) })
      expect(refused.status).toBeGreaterThanOrEqual(400)
    } finally { await rm(previous, { recursive: true, force: true }) }
  })

  // #1277: after the switch-over, business roles decide on the real platform, and one row puts the old rules back.
  test('with the starting roles, the old grants and the switch each set when asked, a store manager opens Dash at their store and staff holding Dash Reader do not; set to the old rules, the old access returns', async ({ admin, createUser }) => {
    const previous = await previousVersion()
    try {
      expect(await discoverPackages([previous])).toEqual([])
      await admin.fetch('/api/install_app', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Featherbase-App-Version': 'dash@0.13.27' }, body: JSON.stringify({ name: 'dash' }) })
      expect(await discoverPackages([previous, APP_DIR])).toEqual([])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'dash', version: VERSION })
      await admin.post('/api/upgrade_app', { name: 'dash', version: VERSION, planId: plan.planId })
      await discoverPackages([previous, APP_DIR])
      await loadInstalledApps()
      await admin.post('/api/activate_app_upgrade', { name: 'dash', version: VERSION })
      expect((await sql`select name from table_def where decides_scope and name like 'dash.%' order by name`).map(r => r.name))
        .toEqual(['dash.access_source', 'dash.business_role', 'dash.business_role_permission', 'dash.role_assignment', 'dash.title_map'])
      await createCoreTables(admin)
      const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)
      await save('Site', { code: 'LKS', name: 'Lakeside', is_store: true })
      await save('Plant', { plant_code: '9901', plant_type: 'Store', site: 'LKS' })
      await save('dash.report', { report_key: 'whole', report_name: 'Store Totals', dive_id: 'made-up-whole-dive', filter_shape: 'Whole stores' })
      // Decision 7: a grant to Dash Reader is carried over to the manager roles; one to a job stays where it is.
      await save('dash.report_access', { report: 'whole', role: 'Dash Reader' })
      await save('dash.report_access', { report: 'whole', job: 'Store Manager' })
      // Dash Reader is the platform's door into Dash; behind it, business roles decide.
      const storeManager = await createUser({ email: 'live-store-manager@example.test', roles: ['Dash Reader'] })
      await save('Employee', { employee_code: 'L1', name: 'Made-up Store Manager', person: storeManager.user, status: 'Current' })
      await save('Job Assignment', { assignment_id: 'JA-L1', employee: 'L1', job: 'Store Manager', site: 'LKS', starts_on: '2026-01-01' })
      const staff = await createUser({ email: 'live-staff@example.test', roles: ['Dash Reader'] })
      await save('Employee', { employee_code: 'L2', name: 'Made-up Staff', person: staff.user, status: 'Current' })
      await save('Job Assignment', { assignment_id: 'JA-L2', employee: 'L2', job: 'Staff', site: 'LKS', starts_on: '2026-01-01' })
      const read = (who: TestClient, name: string, payload: Record<string, unknown> = {}) => who.post<{ result: unknown }>(`/api/app_reads/dash/${name}`, { payload }).then(a => a.result)
      const labels = async (who: TestClient) => (await admin.get<{ places: { label: string }[] }>(`/api/people/${encodeURIComponent(who.user)}/scope?app=dash`)).places.map(p => p.label)
      // Before the switch-over the old rules decide: Dash Reader opens Dash for staff.
      expect(await read(staff, 'can_open')).toBe(true)

      // Nothing switches by itself: after the upgrade the old rules still decide.
      expect(await sql`select 1 from dash.access_source`).toEqual([])
      expect(await sql`select 1 from dash.business_role`).toEqual([])
      const systemManager = await createUser({ email: 'live-system-manager@example.test', roles: ['System Manager'] })
      const act = (name: string) => systemManager.post<{ result: Record<string, unknown> }>(`/api/app_actions/dash/${name}`, { idempotencyKey: crypto.randomUUID(), payload: {} }).then(a => a.result)
      expect(await act('add_starting_roles')).toEqual({ roles: 18, titles: 12 })
      expect(await act('give_old_grants_to_roles')).toEqual({ grants_added: 9, grants_not_converted: 1 })
      expect(await read(staff, 'can_open')).toBe(true)
      // The owner's yes: a System Manager adds the switch row.
      await saveRow(systemManager, 'dash.access_source', { source: 'business_roles' })
      expect([await read(storeManager, 'can_open'), (await read(storeManager, 'reports') as { key: string }[]).map(r => r.key), await labels(storeManager)])
        .toEqual([true, ['whole'], ['9901']])
      // Past access: the made-up report has no store key, so it stops at "not set up", never at no access.
      expect(await read(storeManager, 'report', { report: 'whole', scope: { places: ['9901'] } })).toEqual({ state: 'report_not_set_up' })
      expect(await read(staff, 'can_open')).toBe(false)
      // Run again: nothing more.
      expect([await act('add_starting_roles'), await act('give_old_grants_to_roles')]).toEqual([{ roles: 0, titles: 0 }, { grants_added: 0, grants_not_converted: 1 }])

      // J5: one row back to the old rules, no deploy.
      const [row] = await sql`select row_id, updated_at from dash.access_source`
      await saveRow(admin, 'dash.access_source', { row_id: row.row_id, source: 'legacy', updated_at: row.updated_at })
      expect([await read(staff, 'can_open'), (await read(storeManager, 'reports') as { key: string }[]).map(r => r.key)]).toEqual([true, ['whole']])
      // Someone holding only a Report Access Manager role is refused: giving old grants to roles is System Manager work.
      const accessManager = await createUser({ email: 'live-access-manager@example.test', roles: ['Report Access Manager'] })
      const refused = await accessManager.fetch('/api/app_actions/dash/give_old_grants_to_roles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), payload: {} }) })
      expect(refused.status).toBeGreaterThanOrEqual(400)
    } finally { await rm(previous, { recursive: true, force: true }) }
  })
})
