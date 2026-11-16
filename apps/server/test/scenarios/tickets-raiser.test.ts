// tickets-raiser (#963, #1193), the fenced scenarios of
// openspec/specs/tickets-raiser/spec.md that Tickets' actions and reads
// prove, step by step. The history support reads on Tickets' page is in
// apps/web/test/scenarios/.
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { scenarioFor } from '../scenario'
import { pinning, Tickets, TicketTransitions } from '../tickets-world'

const test = pgTest.extend(pinning)
const scenario = scenarioFor(test, 'tickets-raiser')
const RAISED = 'Anjali raised a Data Quality Issue for SAP, assigned to Bala'
const REASON = 'Anjali only keyed it in'
const CHANGED = `a System Manager changes the raiser to Colleague because "${REASON}"`

/** The change of raiser was refused, and Anjali is still the raiser. */
async function refused(t: Tickets) {
  expect([403, 417], JSON.stringify(t.last.body)).toContain(t.last.status)
  expect((await t.open('Support')).ticket.owner).toBe(t.ids.Anjali)
}

describe('tickets-raiser', () => {
  scenario('The new raiser reads a private ticket and the old raiser no longer does', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    await step('the Data Quality Issue type is private', () => { x.private = true })
    await step(RAISED, () => x.raise())
    await step(CHANGED, () => t.changeRaiser('Manager', 'Colleague', REASON))
    await step("Colleague reads the ticket's details, and Anjali no longer does", async () => {
      expect((await t.open('Colleague')).details, 'the new raiser reads the details').toBeTruthy()
      expect((await t.open('Anjali')).details).toBeUndefined()
    })
    await step('the ticket is still assigned to Bala and in "Raised"', async () => {
      const { ticket } = await t.open('Support')
      expect(ticket.assigned_to).toBe(t.ids.Bala)
      expect(ticket.ticket_state).toBe('Raised')
    })
  })

  scenario("The raiser's step moves to the new raiser", async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    await step(RAISED, () => x.raise())
    await step('Bala asks "Which plant?" and the ticket waits for its raiser', () => x.take('Bala', 'Ask a question', { question: 'Which plant?' }))
    await step(CHANGED, () => t.changeRaiser('Manager', 'Colleague', REASON))
    await step('Colleague may answer it, and Anjali may not', async () => {
      expect(await x.offered('Colleague')).toEqual(['Answer'])
      expect(await x.offered('Anjali')).toEqual([])
    })
  })

  scenario('Support is refused', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    await step(RAISED, () => x.raise())
    await step(`support changes the raiser to Colleague because "${REASON}"`, () => t.changeRaiser('Support', 'Colleague', REASON))
    await step('the change of raiser is refused and Anjali is still the raiser', () => refused(t))
  })

  scenario('A direct save is refused', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    await step(RAISED, () => x.raise())
    await step('a System Manager saves the ticket directly with Colleague as its raiser', async () => {
      await t.person('Manager', ['System Manager'])
      t.last = await t.call('Manager', '/api/save_row', { table: 'tickets.ticket', row: { ...t.revision(), owner: t.ids.Colleague } })
    })
    await step('the change of raiser is refused and Anjali is still the raiser', () => refused(t))
  })

  scenario('No reason is refused', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    await step(RAISED, () => x.raise())
    await step('a System Manager changes the raiser to Colleague without a reason', () => t.changeRaiser('Manager', 'Colleague', ''))
    await step('the change of raiser is refused and Anjali is still the raiser', () => refused(t))
  })

  scenario('A person who has left is refused', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    await step(RAISED, () => x.raise())
    await step('Colleague has been disabled', async () => {
      const person = await admin.get<{ updated_at: string }>(`/api/table/Person/${t.ids.Colleague}`)
      await admin.post('/api/save_row', { table: 'Person', row: { row_id: t.ids.Colleague, updated_at: person.updated_at, enabled: false } })
    })
    await step(CHANGED, () => t.changeRaiser('Manager', 'Colleague', REASON))
    await step('the change of raiser is refused and Anjali is still the raiser', () => refused(t))
  })

  // #1193: an agent names the raiser when it raises the ticket.
  const AGENT_RAISES = "an agent holding System Manager raises a Data Quality Issue for SAP on Anjali's behalf"
  /** The create was refused, and there are as many tickets as before. */
  async function noneCreated(t: Tickets, before: number) {
    expect([403, 417], JSON.stringify(t.last.body)).toContain(t.last.status)
    expect(await t.ticketCount()).toBe(before)
  }

  scenario('An agent raises a private ticket for Anjali', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    await step('the Data Quality Issue type is private', () => { x.private = true })
    await step(AGENT_RAISES, () => x.raiseFor('Agent', 'Anjali'))
    await step("Anjali is the raiser and reads the ticket's details", async () => {
      expect(t.ticket.owner).toBe(t.ids.Anjali)
      expect((await t.open('Anjali')).details).toMatchObject({ current_value: '78/499/1' })
      expect((await t.read('queue', {}, 'Anjali')).tickets.map((row: { row_id: string }) => row.row_id)).toContain(t.ticket.row_id)
    })
    await step("the history says the agent raised it on Anjali's behalf", async () => {
      const detail = await t.open('Support')
      const event = detail.privateEvents.find((e: { operation: string }) => e.operation === 'raise_on_behalf')
      expect(event.by).toBe(t.ids.Agent)
      expect(JSON.parse(event.text)).toEqual({ raiser: t.ids.Anjali })
      expect(detail.names).toMatchObject({ [t.ids.Agent]: 'svc-agent', [t.ids.Anjali]: 'Anjali' })
    })
  })

  scenario("The raiser's step belongs to the named raiser", async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    await step("an agent holding System Manager raised a Data Quality Issue for SAP on Anjali's behalf, assigned to Bala", async () => {
      await x.raiseFor('Agent', 'Anjali')
      expect(t.ticket.assigned_to).toBe(t.ids.Bala)
    })
    await step('Bala asks "Which plant?" and the ticket waits for its raiser', () => x.take('Bala', 'Ask a question', { question: 'Which plant?' }))
    await step('Anjali may answer it, and the agent may not', async () => {
      expect(await x.offered('Anjali')).toEqual(['Answer'])
      expect(await x.offered('Agent')).toEqual([])
    })
  })

  scenario('Support cannot name someone else as raiser', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    let before = 0
    await step("support raises a Data Quality Issue for SAP on Anjali's behalf", async () => {
      await x.configure()
      before = await t.ticketCount()
      await x.raiseFor('Support', 'Anjali', true)
    })
    await step('the ticket is refused and none is created', () => noneCreated(t, before))
  })

  scenario('A person who has left cannot be named', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    let before = 0
    await step('Colleague has been disabled', async () => {
      await x.configure()
      const person = await admin.get<{ updated_at: string }>(`/api/table/Person/${t.ids.Colleague}`)
      await admin.post('/api/save_row', { table: 'Person', row: { row_id: t.ids.Colleague, updated_at: person.updated_at, enabled: false } })
      before = await t.ticketCount()
    })
    await step("an agent holding System Manager raises a Data Quality Issue for SAP on Colleague's behalf", () => x.raiseFor('Agent', 'Colleague', true))
    await step('the ticket is refused and none is created', () => noneCreated(t, before))
  })
})
