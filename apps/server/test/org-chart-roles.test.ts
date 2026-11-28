// #1453: an app's role from the org chart. The app `chartproof` declares that everyone the org chart gives a place
// may hold its role Chart Reader; the places come from test-apps/fixtures/place-roster's positions (a person's rows
// there are their places). It ships on: installing the app writes its Org Chart Role Rule; a System Manager turns it
// off by removing the rule. The job keeps holders in step. Every person and place is made up.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { afterEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { pathToFileURL } from 'node:url'
import { getRoles } from '../src/permissions'
import { sql } from '../src/db'
import { syncOrgChartRoles } from '../src/org-chart-roles'

const APP = 'chartproof'
const provider = resolve('../..', 'test-apps/fixtures/place-roster')
const manifest = (more: Record<string, unknown> = {}) => ({
  manifestVersion: 1, platformVersion: '2026-10', name: APP, title: 'Org chart role proof', entryTable: `${APP}.note`,
  tables: [{ name: `${APP}.note`, label: 'note', id_pattern: 'prompt', columns: [{ column_name: 'body', column_type: 'Data' }] }],
  roles: ['Chart Reader', 'Chart Admin'],
  permissions: [{ table: `${APP}.note`, role: 'Chart Reader', can_read: true }],
  orgChartRoles: ['Chart Reader'],
  ...more,
})
const folders: string[] = []
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })
async function writeApp(more: Record<string, unknown> = {}) {
  const dir = await mkdtemp(resolve('test/.chart-proof-'))
  folders.push(dir)
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `featherbase-${APP}`, version: '1.0.0', type: 'module' }))
  await writeFile(join(dir, 'featherbase.json'), JSON.stringify(manifest(more)))
  // a server module only where the test declares one (a scope provider needs one)
  if (more.server) await writeFile(join(dir, 'server.mjs'), "export const platformVersion = '2026-10'\nexport const scopeProviders = { x: async () => [] }\n")
  return dir
}

/** The app and the place provider, and three made-up people: two with a place, one without. */
async function installed(admin: TestClient, createUser: CreateUserFn) {
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
const position = (admin: TestClient, person: string, place: string, store: string, section: string) =>
  admin.post('/api/save_row', { table: 'placeroster.position', row: { row_id: `${person}-${section}`, person, place, store, section } })
/** On by itself at install (ships on); a System Manager turns it off by removing the rule row. */
async function turnOn(_admin: TestClient, on = true) {
  if (!on) await sql`delete from org_chart_role_rule where app = ${APP}`
}
async function roster(): Promise<{ faults: { provider?: unknown } }> {
  const digest = availableRuntimeVersions().find((p) => p.name === 'placeroster')!.digest
  return import(`${pathToFileURL(resolve(provider, 'server.mjs')).href}?artifact=${digest}`)
}

describe('an app role from the org chart', () => {
  test('ships on: installing writes the rule, logged, and everyone the org chart gives a place holds the role', async ({ admin, createUser }) => {
    const { leader, manager, outsider } = await installed(admin, createUser)
    expect(await sql`select app, app_role from org_chart_role_rule where app = ${APP}`).toEqual([{ app: APP, app_role: 'Chart Reader' }])
    expect((await sql`select 1 from activity_log where operation like ${`app_org_chart_role_added ${APP}%`}`).length).toBe(1)
    // nobody until the job runs, then everyone with a place
    expect(await getRoles(leader)).not.toContain('Chart Reader')
    await syncOrgChartRoles()
    expect(await getRoles(leader)).toContain('Chart Reader')
    expect(await getRoles(manager)).toContain('Chart Reader')
    expect(await getRoles(outsider)).not.toContain('Chart Reader')
    // only the role the app declares
    expect(await getRoles(leader)).not.toContain('Chart Admin')
  })

  test('says who holds it and why', async ({ admin, createUser }) => {
    const { leader } = await installed(admin, createUser)
    await turnOn(admin)
    await syncOrgChartRoles()
    const listed = await admin.get<{ data: { person: string; app: string; app_role: string; why: string }[] }>(`/api/table/${encodeURIComponent('App Role From Org Chart')}?${new URLSearchParams({
      fields: JSON.stringify(['person', 'app', 'app_role', 'why']), filters: JSON.stringify([['person', '=', leader]]) })}`)
    expect(listed.data).toEqual([expect.objectContaining({ person: leader, app: APP, app_role: 'Chart Reader', why: '1 place on the org chart: North kids' })])
  })

  test('follows the records: a leaver, or someone whose place ends, loses it on the next run', async ({ admin, createUser }) => {
    const { leader, manager } = await installed(admin, createUser)
    await turnOn(admin)
    await syncOrgChartRoles()
    await admin.post('/api/save_row', { table: 'Person', row: { row_id: manager, updated_at: (await admin.get<{ updated_at: string }>(`/api/table/Person/${manager}`)).updated_at, enabled: false } })
    await sql`delete from placeroster.position where person = ${leader}`
    await syncOrgChartRoles()
    expect(await getRoles(leader)).not.toContain('Chart Reader')
    expect((await sql`select count(*)::int as n from app_role_from_org_chart`)[0].n).toBe(0)
  })

  test('a provider that cannot answer keeps the last holders, and the run says so', async ({ admin, createUser }) => {
    const { leader } = await installed(admin, createUser)
    await turnOn(admin)
    await syncOrgChartRoles()
    const places = await roster()
    places.faults.provider = new Error('roster down')
    try {
      await expect(syncOrgChartRoles()).rejects.toThrow(/could not say where .* people work; the last holders stand/)
    } finally { delete places.faults.provider }
    expect(await getRoles(leader)).toContain('Chart Reader')
  })

  test('a role the app only adopted (an instance role of the same name) is never given', async ({ admin, createUser }) => {
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Chart Reader' } })
    const { leader } = await installed(admin, createUser)
    await turnOn(admin)
    await syncOrgChartRoles()
    expect(await getRoles(leader)).not.toContain('Chart Reader')
  })

  test('the access explanation says the org chart gave it, and why', async ({ admin, createUser }) => {
    const { leader } = await installed(admin, createUser)
    await turnOn(admin)
    await syncOrgChartRoles()
    const explained = await admin.get<{ roles: { role: string; app: string | null; through: string | null }[] }>(`/api/access_explanation/${leader}`)
    expect(explained.roles).toContainEqual(expect.objectContaining({ role: 'Chart Reader', app: APP, through: 'the org chart (1 place on the org chart: North kids)' }))
  })

  test('turned off again, nobody holds it through the rule', async ({ admin, createUser }) => {
    const { leader } = await installed(admin, createUser)
    await turnOn(admin)
    await syncOrgChartRoles()
    await turnOn(admin, false)
    expect(await getRoles(leader)).not.toContain('Chart Reader')
  })

  test('opens the app’s Table to its holders, as the role would', async ({ admin, createUser }) => {
    await installed(admin, createUser)
    await turnOn(admin)
    await syncOrgChartRoles()
    const reader = await createUser({ email: 'reader@example.test' })
    await position(admin, reader.user!, 'South', 'S1', 'kids')
    await expect(reader.get(`/api/table/${APP}.note`)).rejects.toThrow()
    await syncOrgChartRoles()
    expect(await reader.get(`/api/table/${APP}.note`)).toMatchObject({ data: [] })
  })

  test('the declaration names the app’s own roles only', async () => {
    const problems = async (more: Record<string, unknown>) => JSON.stringify(await discoverPackages([await writeApp(more), provider]))
    expect(await problems({ orgChartRoles: ['System Manager'] })).toContain("not one of the app's own roles")
    expect(await problems({ orgChartRoles: ['Someone Else'] })).toContain("not one of the app's own roles")
    expect(await problems({ server: 'server.mjs', scopeProvider: { name: 'x', tables: [`${APP}.note`] } })).toContain('cannot declare orgChartRoles')
  })
})
