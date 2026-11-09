// tickets-assignees (#964, #1097), each fenced scenario of
// openspec/specs/tickets-assignees/spec.md step by step, against Tickets'
// own actions and reads.
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { scenarioFor } from '../scenario'
import { pinning, Tickets } from '../tickets-world'

const test = pgTest.extend(pinning)
const scenario = scenarioFor(test, 'tickets-assignees')

// Tickets knows a person's name once they have acted in it, so the people act
// before the picker is read.
async function listed(t: Tickets, names: string[]) {
  await t.setup()
  await t.configure({ assignees: names.map(name => t.ids[name]) })
  await t.action('create', { title: 'Colleague files one', original: 'Colleague files one', kind: 'generic', details: {} }, 'Colleague')
  await t.create('generic', {}, 'The dashboard is late')
  await t.action('edit', { public_update: 'Checking' }, 'Support')
}
const offered = async (t: Tickets): Promise<string[]> =>
  (await t.read('session', {}, 'Support')).people.map((person: { row_id: string }) => person.row_id)

describe('tickets-assignees', () => {
  scenario('An assignable person is offered without support rights', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('Colleague is listed only as someone tickets can be assigned to', () => listed(t, ['Colleague']))
    await step("support assigns Anjali's ticket to Colleague", () => t.action('edit', { assigned_to: t.ids.Colleague }, 'Support'))
    await step('the assign picker offers Colleague and Support', async () => {
      const people = await offered(t)
      expect(people).toContain(t.ids.Colleague)
      expect(people).toContain(t.ids.Support)
      expect((await t.open('Support')).ticket.assigned_to).toBe(t.ids.Colleague)
    })
    await step('Colleague has no support rights', async () => {
      const session = await t.read('session', {}, 'Colleague')
      expect(session.capabilities.support).toBe(false)
      expect(session.people).toBeUndefined()
      await t.action('edit', { public_update: 'Looking' }, 'Colleague', true)
      expect([403, 417], JSON.stringify(t.last.body)).toContain(t.last.status)
    })
  })

  scenario('With no one listed, the picker is as before', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('no one is listed as someone tickets can be assigned to', () => listed(t, []))
    await step('the assign picker offers Support and not Colleague', async () => {
      const people = await offered(t)
      expect(people).toContain(t.ids.Support)
      expect(people).not.toContain(t.ids.Colleague)
    })
  })

  scenario('Someone listed before they have used Tickets is offered', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step('Colleague is listed as someone tickets can be assigned to before using Tickets', async () => {
      await t.setup()
      await t.configure({ assignees: [t.ids.Colleague] })
    })
    await step('the assign picker offers Colleague by name', async () => {
      const listedPerson = (await t.read('session', {}, 'Support')).people.find((person: { row_id: string }) => person.row_id === t.ids.Colleague)
      expect(listedPerson?.full_name).toBe('Colleague')
    })
  })
})
