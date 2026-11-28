// #1453: an app's role from the org chart. The app `chartproof` declares that everyone the org chart gives a place
// may hold its role Chart Reader; the places come from test-apps/fixtures/place-roster's positions (a person's rows
// there are their places). It ships on: installing the app writes its Org Chart Role Rule; a System Manager turns it
// off by removing the rule. The job keeps holders in step. Every person and place is made up.
import { afterEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { getRoles } from '../src/permissions'
import { sql } from '../src/db'
import { syncOrgChartRoles } from '../src/org-chart-roles'
import { APP, installed, position, provider, removeChartFolders, roster, turnOn, writeApp } from './chart-proof-app'

afterEach(removeChartFolders)

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
