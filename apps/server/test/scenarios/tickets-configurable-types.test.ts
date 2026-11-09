// tickets-configurable-types (#912), the fenced scenarios of
// openspec/changes/feather-tickets-stage-one/specs/tickets-configurable-types/spec.md
// that Tickets' actions and reads prove, step by step. The ones a person
// reads on Tickets' page are in apps/web/test/scenarios/.
import { describe, expect } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test as pgTest } from '../pg-test'
import { scenarioFor } from '../scenario'
import { pinning, Tickets, TicketTypes } from '../tickets-world'

const test = pgTest.extend(pinning)
const scenario = scenarioFor(test, 'tickets-configurable-types')
const GIVEN_TYPE = 'a System Manager has configured a "Data Quality Issue" type with a required Urgency of Now or Later'
const world = (admin: TestClient, createUser: CreateUserFn) => {
  const t = new Tickets(admin, createUser)
  return { t, x: new TicketTypes(t) }
}
const detail = (x: TicketTypes, actor: string) => x.t.read('detail', { row_id: x.t.ticket.row_id }, actor)

describe('tickets-configurable-types', () => {
  scenario('A configured Data Quality Issue type is used at once', async ({ admin, createUser }, step) => {
    const { t, x } = world(admin, createUser)
    await step(GIVEN_TYPE, () => x.configure())
    await step('Anjali submits that Data Quality Issue without an urgency', () => x.submit({}, 'Anjali', true))
    await step('the submission is refused as missing Urgency', () => {
      expect(t.last.status).toBe(417)
      expect(JSON.stringify(t.last.body)).toMatch(/Urgency is required/)
    })
    await step('Anjali submits that Data Quality Issue with urgency "Later"', () => x.submit({ urgency: 'Later' }))
    await step('the ticket starts in "Open"', () => expect(t.ticket.ticket_state).toBe('Open'))
  })

  scenario('A removed field is no longer asked for', async ({ admin, createUser }, step) => {
    const { t, x } = world(admin, createUser)
    await step(GIVEN_TYPE, () => x.configure())
    await step('the System Manager has removed its Urgency field', () => x.removeField('urgency'))
    await step('Anjali submits that Data Quality Issue without an urgency', () => x.submit({}, 'Anjali', true))
    await step('the ticket starts in "Open"', () => {
      expect(t.last.status, JSON.stringify(t.last.body)).toBe(200)
      expect(t.ticket.ticket_state).toBe('Open')
    })
  })

  scenario('An issue can name a second system', async ({ admin, createUser }, step) => {
    const { x } = world(admin, createUser)
    let seen: any
    await step('Anjali submitted a Data Quality Issue for SAP that also concerns StyleHR', async () => {
      await x.configure()
      await x.submit({ urgency: 'Now', source_system: x.systems.SAP, also_concerns: x.systems.StyleHR })
    })
    await step('support opens that ticket', async () => { seen = await detail(x, 'Support') })
    await step('both SAP and StyleHR are shown on the ticket', () =>
      expect([seen.labels.source_system, seen.labels.also_concerns]).toEqual(['SAP', 'StyleHR']))
  })

  scenario('A colleague sees only the summary of a configured ticket', async ({ admin, createUser }, step) => {
    const { t, x } = world(admin, createUser)
    let seen: any
    await step('Anjali submitted a Data Quality Issue with current value "78/499/1"', () => x.submit({ urgency: 'Now', current_value: '78/499/1' }))
    await step('the colleague opens that ticket', async () => { seen = await detail(x, 'Colleague') })
    await step('its summary is shown and "78/499/1" is not', () => {
      expect(seen.ticket.row_id).toBe(t.ticket.row_id)
      expect(JSON.stringify(seen)).not.toContain('78/499/1')
    })
  })

  scenario('Support moves a ticket through its configured states', async ({ admin, createUser }, step) => {
    const { t, x } = world(admin, createUser)
    await step('Anjali submitted a Data Quality Issue raised on "2026-11-04"', () => x.submit({ urgency: 'Now', raised_on: '2026-11-04' }))
    await step('support resolves that ticket as "Fixed in source"', () =>
      t.action('resolve', { state: 'Fixed in source', reason: 'Corrected in SAP', reference: 'Change note 1' }, 'Support'))
    await step('history records it, it leaves the open queue, and reopening returns it to "Reopened"', async () => {
      expect((await detail(x, 'Support')).privateEvents.some((event: { operation: string }) => event.operation === 'resolve')).toBe(true)
      const open = (await t.read('queue', { state: 'open' }, 'Support')).tickets as { row_id: string }[]
      expect(open.map(ticket => ticket.row_id)).not.toContain(t.ticket.row_id)
      await t.action('reopen', { reason: 'Came back' }, 'Support')
      expect(t.ticket.ticket_state).toBe('Reopened')
    })
  })

  scenario('The primary owner of a source system is the default assignee', async ({ admin, createUser }, step) => {
    const { t, x } = world(admin, createUser)
    await step('the owners Table lists Bala as primary owner of SAP', () => x.configure())
    await step('Anjali submits a Data Quality Issue for SAP', () => x.submit({ urgency: 'Now', source_system: x.systems.SAP }))
    await step('the ticket is assigned to Bala', () => expect(t.ticket.assigned_to).toBe(t.ids.Bala))
  })
})
