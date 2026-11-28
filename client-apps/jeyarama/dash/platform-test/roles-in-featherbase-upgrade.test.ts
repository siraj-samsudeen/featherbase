// #1340: the upgrade to business roles in Featherbase, on an instance like production's: Dash at main's 0.13.44, business
// roles deciding Dash access, and live roles, title maps, hand changes, report grants (a removed one, one to a person, a
// bundle) and reports. Nothing in those Tables is lost or changed, the moved Tables keep every row, id and link, the new
// Tables arrive empty, everyone's access answer is the same after, and asking again finds nothing to do. Made-up data only.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { makeClient, type CreateUserFn, type TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { sql } from '../../src/db'
import { discoverPackages } from '../../src/runtime-packages'
import { loadInstalledApps } from '../../src/apps'
import { APP_DIR, VERSION, createCoreTables, revertRolesInFeatherbase, saveRow } from './helpers'

process.env.MOTHERDUCK_TOKEN = 'made-up-token'
const MAIN = '0.13.44'
/** The version every client says it was built for: main's until the upgrade is active, then this one's. */
let running = MAIN
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { 'X-Featherbase-App-Version': `dash@${running}`, ...init?.headers },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})

/** The Tables production holds live rows in, which the upgrade must leave exactly as they are. */
const LIVE = ['dash.report', 'dash.report_bundle', 'dash.report_bundle_member', 'dash.report_access', 'dash.business_role', 'dash.business_role_permission',
  'dash.title_map', 'dash.role_assignment', 'dash.access_source', 'dash.switch_over_log', 'dash.permission_change']
const MOVED = ['dash.business_role', 'dash.title_map', 'dash.role_assignment', 'dash.report_access', 'dash.access_source']

async function mainVersion(): Promise<string> {
  const directory = await mkdtemp(resolve(APP_DIR, '..', `dash-${MAIN}-`))
  await cp(APP_DIR, directory, { recursive: true })
  const manifest = JSON.parse(await readFile(resolve(directory, 'featherbase.json'), 'utf8'))
  revertRolesInFeatherbase(manifest)
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(manifest, null, 2))
  await writeFile(resolve(directory, 'package.json'), JSON.stringify({ ...pkg, version: MAIN }))
  return directory
}

/** Every row of every live Table, whole, in a fixed order. */
async function rows(): Promise<Record<string, unknown[]>> {
  const all: Record<string, unknown[]> = {}
  for (const table of LIVE) {
    const [schema, name] = table.split('.')
    all[table] = (await sql.unsafe(`select * from "${schema}"."${name}" order by row_id`)).map(r => ({ ...r }))
  }
  return all
}

describe('business roles in Featherbase, on live data', () => {
  test('the upgrade from 0.13.44 with business roles deciding loses or changes no row, keeps access, and runs once', async ({ admin, createUser }) => {
    const previous = await mainVersion()
    running = MAIN
    try {
      expect(await discoverPackages([previous])).toEqual([])
      await admin.fetch('/api/install_app', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Featherbase-App-Version': `dash@${MAIN}` }, body: JSON.stringify({ name: 'dash' }) })
      await createCoreTables(admin)
      const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)

      // Places and reports.
      await save('Site', { code: 'LKS', name: 'Lakeside', is_store: true })
      await save('Site', { code: 'HOF', name: 'Head Office', is_store: false })
      await save('Plant', { plant_code: '9901', plant_type: 'Store', site: 'LKS' })
      for (const [key, name] of [['sales', 'Made-up Sales'], ['stock', 'Made-up Stock'], ['notice', 'Made-up Notices'], ['retired', 'Made-up Retired']])
        await save('dash.report', { report_key: key, report_name: name, dive_id: `made-up-${key}-dive`, filter_shape: 'Whole stores' })
      const bundle = String((await save('dash.report_bundle', { bundle_name: 'Made-up Stock Pack' })).row_id)
      await save('dash.report_bundle_member', { report_bundle: bundle, report: 'stock' })

      // Business roles as production has them, with the permissions that open Dash.
      const role = async (name: string, reaches: string) => {
        const id = String((await save('dash.business_role', { role_name: name, reaches })).row_id)
        await save('dash.business_role_permission', { business_role: id, app: 'Dash', level: 'Reader', verb: 'View', thing: 'Reports', reach: 'Area', permission_key: `${id} / Dash / Reader / View / Reports` })
        return id
      }
      const storeManager = await role('Store Manager', 'Store')
      const tester = await role('Tester', 'Given place')
      const headOffice = await role('Head Office', 'Whole company')
      await save('dash.title_map', { title: 'Store Manager', business_role: storeManager })
      await save('dash.title_map', { title: 'Head office staff', business_role: headOffice })

      // People: a store manager by HR title; a head office person corrected by hand to Tester at the store, given a report
      // as a person; staff with no role.
      const person = async (email: string, code: string, job: string, site: string) => {
        const user = await createUser({ email, roles: ['Dash Reader'] })
        await save('Employee', { employee_code: code, name: `Made-up ${job}`, person: user.user, status: 'Current' })
        await save('Job Assignment', { assignment_id: `JA-${code}`, employee: code, job, site, starts_on: '2026-01-01' })
        return user
      }
      const manager = await person('live-data-manager@example.test', 'M1', 'Store Manager', 'LKS')
      const office = await person('live-data-office@example.test', 'H1', 'Head office staff', 'HOF')
      const staff = await person('live-data-staff@example.test', 'S1', 'Staff', 'LKS')
      await save('dash.role_assignment', { person: office.user, change: 'Correct', business_role: tester, site: 'LKS', reason: 'Tests the store' })

      // Report grants: to a role, a bundle to a role, to a person, and one taken away.
      await save('dash.report_access', { report: 'sales', business_role: storeManager })
      await save('dash.report_access', { report_bundle: bundle, business_role: storeManager })
      await save('dash.report_access', { report: 'notice', person: office.user })
      await save('dash.report_access', { report: 'retired', business_role: storeManager, removed: true })

      // Business roles decide Dash access, as in production since 13:12 today.
      await save('dash.access_source', { source: 'business_roles' })

      const read = (who: TestClient, name: string) => who.post<{ result: unknown }>(`/api/app_reads/dash/${name}`, { payload: {} }).then(a => a.result)
      const access = async () => {
        const answers: unknown[] = []
        for (const who of [manager, office, staff]) {
          const scope = await admin.get<{ places: { label: string }[] }>(`/api/people/${encodeURIComponent(who.user)}/scope?app=dash`)
          answers.push([await read(who, 'can_open'), ((await read(who, 'reports')) as { key: string }[]).map(r => r.key).sort(), scope.places.map(p => p.label).sort()])
        }
        return answers
      }
      const before = await access()
      // The answer is worth comparing: the store manager sees the role's report and the bundle's at their store, the
      // corrected person sees their own report too, and staff with no role do not open Dash.
      expect(before).toEqual([[true, ['sales', 'stock'], ['9901']], [true, ['notice'], ['9901']], [false, [], []]])
      const rowsBefore = await rows()
      const moduleBefore = await sql`select name, module from table_def where name in ${sql(MOVED)} order by name`
      expect(moduleBefore.every(r => r.module === 'Dash')).toBe(true)

      // The upgrade, as production will take it.
      expect(await discoverPackages([previous, APP_DIR])).toEqual([])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string; migrations: { id: string }[] }>('/api/preview_app_upgrade', { name: 'dash', version: VERSION })
      expect(plan.migrations.map(m => m.id)).toEqual(['business_roles_in_featherbase', 'dive_failure_detail', 'report_refusals_explained', 'datasets_kept_as_json', 'row_rules'])
      await admin.post('/api/upgrade_app', { name: 'dash', version: VERSION, planId: plan.planId })
      await discoverPackages([previous, APP_DIR])
      await loadInstalledApps()
      await admin.post('/api/activate_app_upgrade', { name: 'dash', version: VERSION })
      running = VERSION

      // No row lost or changed; the log only gains its new, empty Setup Run column.
      const rowsAfter = await rows()
      rowsAfter['dash.switch_over_log'] = rowsAfter['dash.switch_over_log']!.map(r => {
        const { setup_run: run, ...rest } = r as Record<string, unknown>
        expect(run).toBeNull()
        return rest
      })
      expect(rowsAfter).toEqual(rowsBefore)
      // The moved Tables are under People, every reference still points at its row, and People's home page lists them.
      expect((await sql`select name, module from table_def where name in ${sql(MOVED)} order by name`).map(r => [r.name, r.module])).toEqual(MOVED.slice().sort().map(n => [n, 'People']))
      expect(await sql`select a.row_id from dash.report_access a left join dash.business_role r on r.row_id = a.business_role where a.business_role is not null and r.row_id is null`).toEqual([])
      expect(await sql`select m.row_id from dash.title_map m left join dash.business_role r on r.row_id = m.business_role where r.row_id is null`).toEqual([])
      expect(await sql`select a.row_id from dash.role_assignment a left join dash.business_role r on r.row_id = a.business_role where r.row_id is null`).toEqual([])
      const linked = (await sql`select l.link_to from home_page_link l join home_page p on p.row_id = l.parent where p.module = 'People'`).map(r => r.link_to)
      expect(linked).toEqual(expect.arrayContaining(MOVED))
      // The new Tables arrive empty.
      expect([await sql`select 1 from dash.setup_run`, await sql`select 1 from dash.access_decision`]).toEqual([[], []])
      // Everyone's access is the same.
      expect(await access()).toEqual(before)

      // Asking again finds nothing to do, and changes nothing.
      const again = await admin.fetch('/api/preview_app_upgrade', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'dash', version: VERSION }) })
      const answer = await again.json() as { migrations?: unknown[] }
      expect(again.ok ? answer.migrations : []).toEqual([])
      const rowsAgain = await rows()
      rowsAgain['dash.switch_over_log'] = rowsAgain['dash.switch_over_log']!.map(r => { const { setup_run: _run, ...rest } = r as Record<string, unknown>; return rest })
      expect(rowsAgain).toEqual(rowsBefore)
      expect(await access()).toEqual(before)
    } finally { await rm(previous, { recursive: true, force: true }) }
  })
})
