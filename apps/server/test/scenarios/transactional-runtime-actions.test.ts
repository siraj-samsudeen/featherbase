// transactional-runtime-actions (#1196): an app counts rows as its caller,
// proved through Tickets' rule preview, which counts a linked Table.
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { scenarioFor } from '../scenario'
import { pinning, TicketRules, Tickets } from '../tickets-world'

const test = pgTest.extend(pinning)
const scenario = scenarioFor(test, 'transactional-runtime-actions')

describe('transactional-runtime-actions', () => {
  scenario('An app counts only what its caller reads', async ({ admin, createUser }, step) => {
    const x = new TicketRules(new Tickets(admin, createUser))
    await step('a linked Table "Buyer Assignment" with 3 rows, and a person who may not read it', () => x.desk())
    let answer: { count: number | null } = { count: -1 }
    await step('the app counts the rows of "Buyer Assignment" for that person', async () => {
      answer = await x.preview('Buyer Assignment', [['role', '=', 'Buyer'], ['person', 'is blank', null]], 'Colleague')
    })
    await step('there is no count', () => expect(answer.count).toBeNull())
    await step('for a person who reads it, the count is 3', async () =>
      expect((await x.preview('Buyer Assignment', [['role', '=', 'Buyer'], ['person', 'is blank', null]], 'Bala')).count).toBe(3))
  })
})
