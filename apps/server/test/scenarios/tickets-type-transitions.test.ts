// tickets-type-transitions (#918, #925), the fenced scenarios of
// openspec/specs/tickets-type-transitions/spec.md that Tickets' actions and
// reads prove, step by step. The one a person takes on Tickets' page is in
// apps/web/test/scenarios/.
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { scenarioFor } from '../scenario'
import { pinning, Tickets, TicketTransitions } from '../tickets-world'

const test = pgTest.extend(pinning)
const scenario = scenarioFor(test, 'tickets-type-transitions')
const RAISED = 'Anjali raised a Data Quality Issue for SAP, assigned to Bala'
const ASKED = 'Bala asks "Which plant?" and Anjali answers "Plant 1100"'

async function askAndAnswer(x: TicketTransitions) {
  await x.take('Bala', 'Ask a question', { question: 'Which plant?' })
  await x.take('Anjali', 'Answer', { answer: 'Plant 1100' })
}
/** That person reads the private ticket's details as its raiser does. */
async function reads(x: TicketTransitions, name: string) {
  const seen = await x.t.open(name)
  expect(seen.details?.current_value, `${name} reads the details`).toBe('78/499/1')
  return seen
}
async function readsNot(x: TicketTransitions, name: string) {
  const seen = await x.t.open(name)
  expect(seen.details, `${name} does not read the details`).toBeUndefined()
  expect(JSON.stringify(seen)).not.toContain('78/499/1')
}

describe('tickets-type-transitions', () => {
  scenario('A move the type does not list is refused', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    await step('a Data Quality Issue type whose assignee confirms a raised issue with what will be fixed, where, and a target date', () => x.configure())
    await step(RAISED, () => x.raise())
    await step('support sets the ticket\'s state to "Closed" directly', () => t.action('edit', { state: 'Closed' }, 'Support', true))
    await step('the change is refused and the ticket stays in "Raised"', async () => {
      expect(t.last.status, JSON.stringify(t.last.body)).toBe(417)
      expect((await t.open('Support')).ticket.ticket_state).toBe('Raised')
    })
  })

  scenario('The raiser or a verifier verifies the fix', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    await step('a Data Quality Issue that Bala has marked fixed', () => x.markedFixed())
    await step('Anjali and a Data Quality verifier may verify it, and Bala may not', async () => {
      await x.roleHolder()
      expect(await x.offered('Anjali')).toEqual(['Verify', 'Not fixed'])
      expect(await x.offered('DQ Verifier')).toEqual(['Verify'])
      expect(await x.offered('Bala')).toEqual([])
    })
    await step('the verifier verifies it', () => x.take('DQ Verifier', 'Verify'))
    await step('the ticket is closed and leaves the open queue', async () => {
      expect(t.ticket.ticket_state).toBe('Closed')
      const open = (await t.read('queue', { state: 'open' }, 'Support')).tickets as { row_id: string }[]
      expect(open.map(ticket => ticket.row_id)).not.toContain(t.ticket.row_id)
    })
  })

  scenario('A question and its answer are kept', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    await step(RAISED, () => x.raise())
    await step(ASKED, () => askAndAnswer(x))
    await step('the ticket is back in "Raised" and its history shows Bala asking and Anjali answering, with both texts', async () => {
      expect(t.ticket.ticket_state).toBe('Raised')
      const events = (await t.open('Support')).privateEvents
        .filter((e: { operation: string }) => e.operation === 'transition')
        .map((e: { by: string; text: string }) => ({ by: e.by, ...JSON.parse(e.text) }))
      expect(events.map((e: { by: string; action: string; values: Record<string, string> }) => [e.by, e.action, Object.values(e.values)[0]]))
        .toEqual([[t.ids.Bala, 'Ask a question', 'Which plant?'], [t.ids.Anjali, 'Answer', 'Plant 1100']])
    })
  })

  scenario('Data Quality Issue details are open to everyone', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    await step(RAISED, () => x.raise())
    await step(ASKED, () => askAndAnswer(x))
    await step('a colleague reads the question and "Plant 1100"', async () => {
      const seen = await x.t.open('Colleague')
      expect(seen.details.question).toBe('Which plant?')
      expect(seen.details.answer).toBe('Plant 1100')
    })
  })

  scenario('A private type shows others only the actions', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    await step('the Data Quality Issue type is private', () => { x.private = true })
    await step(RAISED, () => x.raise())
    await step(ASKED, () => askAndAnswer(x))
    await step('a colleague sees that a question was asked and answered, but not "Plant 1100"', async () => {
      const seen = await x.t.open('Colleague')
      expect(seen.events.map((e: { text: string }) => e.text)).toEqual(['Ask a question: Raised → Waiting for raiser', 'Answer: Waiting for raiser → Raised'])
      expect(JSON.stringify(seen)).not.toContain('Plant 1100')
    })
  })

  scenario('The assignee and the person it is raised for read a private ticket', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    await step('the Data Quality Issue type is private', () => { x.private = true })
    await step('Pat raised a Data Quality Issue for SAP on behalf of Ravi, and support assigned it to Colleague', async () => {
      await x.configure()
      // The raiser names the person it is raised for, so may see people.
      await x.types.reader('Pat')
      for (const name of ['Ravi', 'Meera']) await t.person(name, ['All'])
      await x.types.submit({ urgency: 'Now', source_system: x.types.systems.SAP, current_value: '78/499/1', raised_for: t.ids.Ravi }, 'Pat')
      await t.action('edit', { assigned_to: t.ids.Colleague }, 'Support')
    })
    await step("Colleague and Ravi read the ticket's details, but not support's history", async () => {
      for (const name of ['Colleague', 'Ravi']) expect((await reads(x, name)).privateEvents).toBeUndefined()
      expect((await t.open('Support')).privateEvents.length, 'support keeps its history').toBeGreaterThan(0)
    })
    await step('Anjali, who is not named on the ticket, does not read them', () => readsNot(x, 'Anjali'))
    await step('support reassigns the ticket to Meera', () => t.action('edit', { assigned_to: t.ids.Meera }, 'Support'))
    await step("Meera reads the ticket's details, and Colleague no longer does", async () => {
      await reads(x, 'Meera')
      await readsNot(x, 'Colleague')
    })
  })
})
