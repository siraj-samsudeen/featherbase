// #1192: production runs Dash 0.12.10; upgrading it to this version creates Dash All-Stores
// Reader with its read of dash.report, and someone given the role then opens Dash. The 0.12.10
// here is this version with the role and its version step taken out, as 0.12.10 declared it.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { sql } from '../../src/db'
import { discoverPackages } from '../../src/runtime-packages'
import { loadInstalledApps } from '../../src/apps'
import { APP_DIR, VERSION, pinned } from './helpers'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
process.env.MOTHERDUCK_TOKEN = 'made-up-token'
const ROLE = 'Dash All-Stores Reader'

/** Dash 0.12.10 as production runs it: no All-Stores Reader, its ledger ending at opens_for_dash_roles. */
async function previousVersion(): Promise<string> {
  const directory = await mkdtemp(resolve(APP_DIR, '..', 'dash-0.12.10-'))
  await cp(APP_DIR, directory, { recursive: true })
  const manifest = JSON.parse(await readFile(resolve(directory, 'featherbase.json'), 'utf8'))
  const without = (roles: string[]) => roles.filter(role => role !== ROLE)
  manifest.roles = without(manifest.roles)
  manifest.permissions = manifest.permissions.filter((p: { role: string }) => p.role !== ROLE)
  for (const op of Object.values(manifest.reads.operations) as { policy: { readRoles?: string[] } }[])
    if (op.policy.readRoles) op.policy.readRoles = without(op.policy.readRoles)
  // Steps after it (#1175's sections_not_mine) are not in 0.12.10 either.
  while (manifest.migrations.length && manifest.migrations.at(-1).id !== 'all_stores_reader') manifest.migrations.pop()
  expect(manifest.migrations.pop()).toMatchObject({ id: 'all_stores_reader', fromVersion: '0.12.10' })
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(manifest, null, 2))
  await writeFile(resolve(directory, 'package.json'), JSON.stringify({ ...pkg, version: '0.12.10' }))
  return directory
}

describe('upgrading production\'s Dash 0.12.10', () => {
  test('creates Dash All-Stores Reader and its read of dash.report, and its holder opens Dash', async ({ admin, createUser }) => {
    const previous = await previousVersion()
    try {
      const at = (version: string) => ({ 'X-Featherbase-App-Version': `dash@${version}` })
      expect(await discoverPackages([previous])).toEqual([])
      await admin.fetch('/api/install_app', { method: 'POST', headers: { 'content-type': 'application/json', ...at('0.12.10') }, body: JSON.stringify({ name: 'dash' }) })
      expect(await sql`select 1 from role where row_id = ${ROLE}`).toEqual([])
      expect(await discoverPackages([previous, APP_DIR])).toEqual([])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string; roles: unknown; permissions: unknown; migrations: { id: string }[] }>('/api/preview_app_upgrade', { name: 'dash', version: VERSION })
      expect([plan.roles, plan.permissions, plan.migrations.map(m => m.id)])
        .toEqual([[{ create: ROLE }], [{ grant: { table: 'dash.report', role: ROLE, operations: { read: '@basic' } } }], ['all_stores_reader', 'sections_not_mine']])
      await admin.post('/api/upgrade_app', { name: 'dash', version: VERSION, planId: plan.planId })
      await discoverPackages([previous, APP_DIR])
      await loadInstalledApps()
      await admin.post('/api/activate_app_upgrade', { name: 'dash', version: VERSION })
      const [installed] = await sql`select package_version, roles, migration_ledger from installed_app where name = 'dash'`
      expect([installed.package_version, installed.roles, (installed.migration_ledger as { id: string }[]).slice(-3).map(m => m.id)])
        .toEqual([VERSION, ['Dash Reader', 'Report Access Manager', ROLE], ['opens_for_dash_roles', 'all_stores_reader', 'sections_not_mine']])
      expect(await sql`select ref_table, operation from permission where role = ${ROLE} order by operation`).toEqual([{ ref_table: 'dash.report', operation: 'read' }])
      const holder = await createUser({ email: 'upgrade-holder@example.test', roles: [ROLE] })
      expect((await holder.post<{ result: unknown }>('/api/app_reads/dash/can_open', { payload: {} })).result).toBe(true)
    } finally { await rm(previous, { recursive: true, force: true }) }
  })
})
