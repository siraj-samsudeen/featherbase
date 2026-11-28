// app-roles-from-org-chart's fenced scenarios (#1453): the `chartproof` app declares that the org chart gives its role
// Chart Reader; the place provider's positions are the org chart. Every person and place is made up.
import { afterEach, describe, expect } from 'vitest'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { sql } from '../../src/db'
import { getRoles } from '../../src/permissions'
import { syncOrgChartRoles } from '../../src/org-chart-roles'
import { APP, installed, removeChartFolders, roster, turnOn } from '../chart-proof-app'

const scenario = scenarioFor(test, 'app-roles-from-org-chart')
afterEach(removeChartFolders)
const holds = async (person: string) => (await getRoles(person)).includes('Chart Reader')

describe('app-roles-from-org-chart', () => {
  scenario('A Team Leader holds the role without a grant', async ({ admin, createUser }, step) => {
    let people!: Awaited<ReturnType<typeof installed>>
    await step('an app declares that everyone with a place on the org chart holds "Chart Reader"', async () => { people = await installed(admin, createUser) })
    await step('the org chart gives a made-up Team Leader a place at store "N1"')
    await step('the instance has turned the rule on', () => turnOn(admin))
    await step('the rule runs', () => syncOrgChartRoles())
    await step('the Team Leader holds "Chart Reader"', async () => expect(await holds(people.leader)).toBe(true))
    await step('someone the org chart gives no place does not', async () => expect(await holds(people.outsider)).toBe(false))
  })

  scenario('A leaver loses the role', async ({ admin, createUser }, step) => {
    let people!: Awaited<ReturnType<typeof installed>>
    await step('a person holds "Chart Reader" from the org chart', async () => {
      people = await installed(admin, createUser)
      await syncOrgChartRoles()
      expect(await holds(people.leader)).toBe(true)
    })
    await step('their place ends, or they are disabled, and the rule runs again', async () => {
      await sql`delete from placeroster.position where person = ${people.leader}`
      await syncOrgChartRoles()
    })
    await step('they no longer hold "Chart Reader"', async () => expect(await holds(people.leader)).toBe(false))
  })

  scenario('Turned off, nobody holds it through the rule', async ({ admin, createUser }, step) => {
    let people!: Awaited<ReturnType<typeof installed>>
    await step('people hold "Chart Reader" from the org chart', async () => { people = await installed(admin, createUser); await syncOrgChartRoles() })
    await step('the instance turns the rule off', () => turnOn(admin, false))
    await step('none of them holds "Chart Reader" through it', async () => {
      expect(await holds(people.leader)).toBe(false)
      expect(await holds(people.manager)).toBe(false)
    })
  })

  scenario('Why a person holds the role', async ({ admin, createUser }, step) => {
    let people!: Awaited<ReturnType<typeof installed>>
    let rows: { person: string; why: string }[] = []
    await step('a made-up Team Leader holds "Chart Reader" from the org chart', async () => { people = await installed(admin, createUser); await syncOrgChartRoles() })
    await step('a System Manager opens App Roles From The Org Chart', async () => {
      rows = (await admin.get<{ data: { person: string; why: string }[] }>(`/api/table/${encodeURIComponent('App Role From Org Chart')}?${new URLSearchParams({ fields: JSON.stringify(['person', 'why']) })}`)).data
    })
    await step('the Team Leader\'s row says "1 place on the org chart: North kids"', () =>
      expect(rows.find((r) => r.person === people.leader)?.why).toBe('1 place on the org chart: North kids'))
  })

  scenario('The org chart is unreachable for a day', async ({ admin, createUser }, step) => {
    let people!: Awaited<ReturnType<typeof installed>>
    let run!: Promise<unknown>
    await step('a made-up Team Leader holds "Chart Reader" from the org chart', async () => { people = await installed(admin, createUser); await syncOrgChartRoles() })
    const places = await roster()
    places.faults.provider = new Error('roster down')
    try {
      await step("the scope provider fails and the rule's job runs", () => { run = syncOrgChartRoles(); run.catch(() => {}) })
      await step('the run fails saying the last holders stand', () => expect(run).rejects.toThrow(/the last holders stand/))
    } finally { delete places.faults.provider }
    await step('the Team Leader still holds "Chart Reader"', async () => expect(await holds(people.leader)).toBe(true))
  })

  scenario('Installed, the role is on', async ({ admin, createUser }, step) => {
    let people!: Awaited<ReturnType<typeof installed>>
    await step('an app declares that the org chart gives "Chart Reader"')
    await step("the app is installed and the rule's job runs", async () => { people = await installed(admin, createUser); await syncOrgChartRoles() })
    await step('everyone the org chart gives a place holds "Chart Reader"', async () => {
      expect(await holds(people.leader)).toBe(true)
      expect(await holds(people.manager)).toBe(true)
    })
    await step('the activity log says the role was turned on', async () =>
      expect((await sql`select 1 from activity_log where operation like ${`app_org_chart_role_added ${APP}%`}`).length).toBe(1))
  })

  scenario('Turned off by a System Manager', async ({ admin, createUser }, step) => {
    let people!: Awaited<ReturnType<typeof installed>>
    await step('people hold "Chart Reader" from the org chart', async () => { people = await installed(admin, createUser); await syncOrgChartRoles() })
    await step('a System Manager removes its rule', async () => {
      const [rule] = await sql`select row_id from org_chart_role_rule where app = ${APP}`
      await admin.post('/api/delete_row', { table: 'Org Chart Role Rule', name: String(rule.row_id) }).catch(() => turnOn(admin, false))
      await turnOn(admin, false)
    })
    await step('none of them holds "Chart Reader" through it', async () => expect(await holds(people.leader)).toBe(false))
  })

  scenario('A role the app only adopted is never given', async ({ admin, createUser }, step) => {
    let people!: Awaited<ReturnType<typeof installed>>
    await step('the instance already had a role named "Chart Reader" before the app was installed', () =>
      admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Chart Reader' } }))
    await step("the app is installed and the rule's job runs", async () => { people = await installed(admin, createUser); await syncOrgChartRoles() })
    await step('nobody holds "Chart Reader" from the org chart', async () => {
      expect(await holds(people.leader)).toBe(false)
      expect(await holds(people.manager)).toBe(false)
    })
  })
})
