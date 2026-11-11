// tickets-data-quality-rules (#1196), the fenced scenarios of the change's spec
// that Tickets' actions and reads prove. Those a person takes on Tickets' page
// are in apps/web/test/scenarios/.
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { scenarioFor } from '../scenario'
import { BUYER_BLANK, pinning, TicketRules, Tickets } from '../tickets-world'

const test = pgTest.extend(pinning)
const scenario = scenarioFor(test, 'tickets-data-quality-rules')
const RAISED = 'Anjali raised a Data Quality Issue for SAP, assigned to Bala'
const DESK = 'the linked Table "Buying Desk" has 3 buyer rows whose person is blank'
const WITH_RULE = 'a ticket with the rule "Buyer is blank" and 3 of 3 rows left'

async function left(x: TicketRules, expected: number | null, raised = 3) {
  const rule = await x.ruleNamed('Buyer is blank')
  expect(rule.rows_when_raised).toBe(raised)
  expect(rule.rows_left).toBe(expected)
}

describe('tickets-data-quality-rules', () => {
  scenario('A rule counts the rows it describes', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await step(RAISED, () => x.transitions.raise())
    await step(DESK, () => x.desk())
    await step('Bala adds the rule "Buyer is blank" on "Buying Desk" where role is "Buyer" and person is blank', () => x.add())
    await step('the ticket shows "Buyer is blank" with 3 of 3 rows left', async () => {
      await left(x, 3)
      expect(await x.ruleNamed('Buyer is blank')).toMatchObject({ table: 'Buying Desk', severity: 'Medium',
        filters: BUYER_BLANK.filters, how_to_fix: BUYER_BLANK.how_to_fix, owner: x.t.ids.Bala })
    })
  })

  scenario('Fixing the rows makes a rule all clear', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await step(WITH_RULE, () => x.withRule())
    await step('a person is filled in on one of those rows', () => x.fill(1))
    await step('the rule has 2 of 3 rows left', () => left(x, 2))
    await step('when the other two are filled in, the rule is all clear', async () => { await x.fill(2); await left(x, 0) })
  })

  scenario('A row that matches again brings the count back', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await step('a ticket whose rule "Buyer is blank" is all clear', async () => { await x.withRule(); await x.fill(3); await left(x, 0) })
    await step('a new buyer row is added with no person', () => x.newBlankBuyer())
    await step('the rule has 1 of 3 rows left', () => left(x, 1))
  })

  scenario('A reader who cannot read the Table sees no count', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await step(WITH_RULE, () => x.withRule())
    let seen: Awaited<ReturnType<TicketRules['rules']>> = []
    await step('Colleague, who may not read "Buying Desk", opens the ticket', async () => { seen = await x.rules('Colleague') })
    await step('Colleague sees the rule without a count', () => {
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({ title: 'Buyer is blank', rows_left: null })
    })
  })

  scenario('A rule on a Table that is not linked is refused', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await step(RAISED, () => x.raised())
    await step('Bala adds a rule on a Table that is not linked to Tickets', () => x.add({ ...BUYER_BLANK, table: 'Person' }, 'Bala', true))
    await step('the rule is refused as not on a linked Table', async () => {
      x.refusedWith(/linked/i)
      expect(await x.rules()).toEqual([])
    })
  })

  scenario('A rule that matches nothing is refused', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await step(RAISED, () => x.transitions.raise())
    await step(DESK, () => x.desk())
    await step('Bala adds a rule where role is "Category head" and person is blank', () =>
      x.add({ ...BUYER_BLANK, title: 'Category head is blank', filters: [['role', '=', 'Category head'], ['person', 'is blank', null]] }, 'Bala', true))
    await step('the rule is refused as matching no rows', async () => {
      x.refusedWith(/matches no rows/i)
      expect(await x.rules()).toEqual([])
    })
  })

  scenario('A rule on a column the Table lacks is refused', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await step(RAISED, () => x.raised())
    await step('Bala adds a rule on "Buying Desk" where "shoe size" is blank', () =>
      x.add({ ...BUYER_BLANK, filters: [['shoe size', 'is blank', null]] }, 'Bala', true))
    await step('the rule is refused, naming "shoe size"', () => x.refusedWith(/shoe size/))
  })

  scenario('Someone not involved in the ticket cannot add a rule', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await step(RAISED, () => x.raised())
    await step('Colleague adds the rule "Buyer is blank"', () => x.add(BUYER_BLANK, 'Colleague', true))
    await step('the rule is refused', async () => {
      x.t.denied()
      expect(await x.rules()).toEqual([])
    })
  })

  scenario('Bala removes a rule', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await step(WITH_RULE, () => x.withRule())
    await step('Bala removes it because "Raised on the wrong ticket"', () => x.remove('Raised on the wrong ticket'))
    await step('the ticket has no rules', async () => expect(await x.rules()).toEqual([]))
    await step('its history shows the rule removed because "Raised on the wrong ticket"', async () => {
      const events = (await x.t.open('Bala')).privateEvents as { operation: string; text: string }[]
      const removed = events.find(e => e.operation === 'remove_rule')
      expect(removed, JSON.stringify(events)).toBeDefined()
      expect(JSON.parse(removed!.text)).toMatchObject({ title: 'Buyer is blank', reason: 'Raised on the wrong ticket' })
    })
  })
})
