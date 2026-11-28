// #1453: the `chartproof` app (a role the org chart gives) and the place provider, for the org-chart role tests and
// their spec scenarios. Every person and place is made up.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { expect } from 'vitest'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'

export const APP = 'chartproof'
export const provider = resolve('../..', 'test-apps/fixtures/place-roster')
export const manifest = (more: Record<string, unknown> = {}) => ({
  manifestVersion: 1, platformVersion: '2026-10', name: APP, title: 'Org chart role proof', entryTable: `${APP}.note`,
  tables: [{ name: `${APP}.note`, label: 'note', id_pattern: 'prompt', columns: [{ column_name: 'body', column_type: 'Data' }] }],
  roles: ['Chart Reader', 'Chart Admin'],
  permissions: [{ table: `${APP}.note`, role: 'Chart Reader', can_read: true }],
  orgChartRoles: ['Chart Reader'],
  ...more,
})
const folders: string[] = []
/** Remove the app folders written so far (call from afterEach). */
export async function removeChartFolders() { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) }
export async function writeApp(more: Record<string, unknown> = {}) {
  const dir = await mkdtemp(resolve('test/.chart-proof-'))
  folders.push(dir)
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `featherbase-${APP}`, version: '1.0.0', type: 'module' }))
  await writeFile(join(dir, 'featherbase.json'), JSON.stringify(manifest(more)))
  // a server module only where the test declares one (a scope provider needs one)
  if (more.server) await writeFile(join(dir, 'server.mjs'), "export const platformVersion = '2026-10'\nexport const scopeProviders = { x: async () => [] }\n")
  return dir
}

/** The app and the place provider, and three made-up people: two with a place, one without. */
export async function installed(admin: TestClient, createUser: CreateUserFn) {
  expect(await discoverPackages([await writeApp(), provider])).toEqual([])
  await admin.post('/api/install_app', { name: APP })
  await admin.post('/api/install_app', { name: 'placeroster' })
  const leader = (await createUser({ email: 'leader@example.test' })).user!
  const manager = (await createUser({ email: 'manager@example.test' })).user!
  const outsider = (await createUser({ email: 'outsider@example.test' })).user!
  await position(admin, leader, 'North kids', 'N1', 'kids')
  await position(admin, manager, 'North', 'N1', 'mens')
  return { leader, manager, outsider }
}
export const position = (admin: TestClient, person: string, place: string, store: string, section: string) =>
  admin.post('/api/save_row', { table: 'placeroster.position', row: { row_id: `${person}-${section}`, person, place, store, section } })
/** On by itself at install (ships on); a System Manager turns it off by removing the rule row. */
export async function turnOn(_admin: TestClient, on = true) {
  if (!on) await sql`delete from org_chart_role_rule where app = ${APP}`
}
export async function roster(): Promise<{ faults: { provider?: unknown } }> {
  const digest = availableRuntimeVersions().find((p) => p.name === 'placeroster')!.digest
  return import(`${pathToFileURL(resolve(provider, 'server.mjs')).href}?artifact=${digest}`)
}

