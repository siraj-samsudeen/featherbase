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
      expect(plan.migrations.map(m => m.id)).toEqual(['business_roles_shadow'])
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
      const manager = await createUser({ email: 'shadow-manager@example.test', roles: ['Dash Reader', MANAGER] })
      const act = (name: string, payload: Record<string, unknown>) => manager.post<{ result: unknown }>(`/api/app_actions/dash/${name}`, { idempotencyKey: crypto.randomUUID(), payload })
      await act('add_starting_roles', {})
      const page = (await manager.post<{ result: { roles: { id: string; name: string }[] } }>('/api/app_reads/dash/business_roles', { payload: {} })).result
      expect(page.roles).toHaveLength(12)
      const storeManager = page.roles.find(r => r.name === 'Store Manager')!.id
      await act('give_role', { person: reader.user, change: 'Correct', role: storeManager, reason: 'Runs the store' })
      // A role that would reach every store in the new model, and a mapping that changes the reader's title: neither may leak into today.
      await act('give_role', { person: reader.user, change: 'Also give', role: page.roles.find(r => r.name === 'Leadership')!.id })
      await act('map_title', { title: 'Staff', role: page.roles.find(r => r.name === 'Head Office')!.id })
      const explained = (await manager.post<{ result: { roles: { name: string; source: string }[] } }>('/api/app_reads/dash/explain_person', { payload: { person: reader.user } })).result
      expect(explained.roles.map(r => [r.name, r.source])).toEqual([['Store Manager', 'Corrected by hand'], ['Leadership', 'Also given by hand']])

      expect(await todays()).toEqual(before)
      expect(await scope()).toEqual(scopeBefore)
      const refused = await reader.fetch('/api/app_reads/dash/business_roles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: {} }) })
      expect(refused.status).toBeGreaterThanOrEqual(400)
    } finally { await rm(previous, { recursive: true, force: true }) }
  })
})
