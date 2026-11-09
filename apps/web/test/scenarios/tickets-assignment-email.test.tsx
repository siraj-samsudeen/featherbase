// tickets-assignment-email (#1001, #1069), the fenced scenarios on Tickets'
// ticket screen, step by step, rendered in jsdom against the real in-process
// server; what the Email Queue alone proves is in apps/server/test/scenarios/.
import { screen } from '@testing-library/react'
import { describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { settleSandboxRequests } from 'server/test/pg-test-shared'
import { pinning, Tickets, TicketsAssignmentEmail } from 'server/test/tickets-world'
import { test as base, expect, type Session } from '../pg-test'
import { openTickets, ticketOpens } from '../tickets-page'

const test = base.extend(pinning)
const scenario = scenarioFor(test, 'tickets-assignment-email')
const RAISED = 'Anjali has raised a ticket that support can assign'
const LISTED = 'Colleague is listed as someone tickets can be assigned to'
const CONFIRM = '[aria-label="Confirm the assignee"]'

// The picker's options by their value, a person's id: the DSL reads options by their text.
const picker = () => screen.getByRole('combobox', { name: 'Assigned to' }) as HTMLSelectElement
const confirmRow = () => screen.queryByRole('group', { name: 'Confirm the assignee' })

/** That person's ticket screen, open on this ticket. */
async function openOnScreen(x: TicketsAssignmentEmail, actor: string): Promise<{ session: Session }> {
  const { session } = await openTickets(x.t.people[actor]!, `?ticket=${x.t.ticket.row_id}`)
  await ticketOpens(session).within('header.ticket-header', (header) => header.assertText(x.title))
  return { session }
}
async function pick(x: TicketsAssignmentEmail, name: string): Promise<{ session: Session }> {
  const { session } = await openOnScreen(x, 'Support')
  // By the person's id, the option's value: the scenario names people by their part, not the name the picker shows.
  await session.step(`pick ${name} as the assignee`, ({ user }) => user.selectOptions(picker(), x.t.ids[name]!))
  return { session }
}
async function mail(x: TicketsAssignmentEmail) {
  await settleSandboxRequests()
  return x.t.mail()
}

describe('tickets-assignment-email', () => {
  scenario('Assigning on the ticket screen', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    await step(RAISED, async () => {
      // The queue lists tickets by id: an earlier one comes first, so only the link can choose Anjali's.
      await x.t.setup()
      await x.t.action('create', { title: 'An earlier ticket', original: 'An earlier ticket', kind: 'generic', details: {} }, 'Bala')
      await x.raise()
    })
    await step(LISTED, () => x.assignable('Colleague'))
    await step('support assigns the ticket to Colleague on the ticket screen', async () => {
      const { session } = await pick(x, 'Colleague')
      await session
        .within(CONFIRM, (confirm) => confirm.clickButton('Assign'))
        .until('an email is queued', async () => (await mail(x)).length > 0)
    })
    await step('Colleague is emailed once about the ticket', async () => {
      await settleSandboxRequests()
      expect(await x.t.mailTo('Colleague')).toHaveLength(1)
    })
    await step('the link in the email opens that ticket for Colleague', async () => {
      const [{ body }] = await x.t.mailTo('Colleague')
      const link = new URL(/Open it here: (\S+)/.exec(body)![1]!)
      expect(link.pathname).toBe('/tickets/')
      expect((await x.t.read('queue', {}, 'Colleague')).tickets[0].row_id).not.toBe(x.t.ticket.row_id)
      const { session } = await openTickets(x.t.people.Colleague!, link.search)
      // After the queue has loaded, and it isn't the first ticket in it: the link chose it.
      await ticketOpens(session
        .until('the queue has loaded', () => !document.body.textContent?.includes('Loading queue')))
        .within('header.ticket-header', (header) => header.assertText(x.title))
    })
  })

  scenario('Picking a person asks before anything is saved', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    let session!: Session
    await step(RAISED, () => x.raise())
    await step(LISTED, () => x.assignable('Colleague'))
    await step('support picks Colleague as the assignee on the ticket screen', async () => {
      ;({ session } = await pick(x, 'Colleague'))
    })
    await step('the ticket screen asks "Assign to Colleague and email them?"', () => {
      // The scenario names people by their part; the screen shows the name the picker lists.
      const name = picker().querySelector(`option[value="${x.t.ids.Colleague}"]`)!.textContent!.trim()
      return session.within(CONFIRM, (confirm) => confirm.assertText(`Assign to ${name} and email them?`))
    })
    await step('nobody is emailed about the ticket', async () => expect(await mail(x)).toEqual([]))
  })

  scenario('Cancelling keeps the ticket as it was', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    let session!: Session
    await step(RAISED, () => x.raise())
    await step(LISTED, () => x.assignable('Colleague'))
    await step('support picks Colleague as the assignee on the ticket screen', async () => {
      ;({ session } = await pick(x, 'Colleague'))
    })
    await step('support cancels the assignment', () =>
      session
        .within(CONFIRM, (confirm) => confirm.clickButton('Cancel'))
        .until('the confirmation has closed', () => !confirmRow()))
    await step('the ticket screen shows the ticket as Unassigned', async () => {
      await session.assertSelected('Assigned to', 'Unassigned')
      const { session: reopened } = await openOnScreen(x, 'Support')
      await reopened.assertSelected('Assigned to', 'Unassigned')
    })
    await step('nobody is emailed about the ticket', async () => expect(await mail(x)).toEqual([]))
  })

  scenario('The requester sees the assignee as text', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    let session!: Session
    await step(RAISED, () => x.raise())
    await step('Anjali opens her ticket on the ticket screen', async () => {
      ;({ session } = await openOnScreen(x, 'Anjali'))
    })
    await step('Anjali sees the ticket as Unassigned, with no way to assign it', async () => {
      await session.within('header.ticket-header .ticket-facts', (facts) => facts.assertText('Unassigned'))
      expect(screen.queryByRole('combobox', { name: 'Assigned to' })).toBeNull()
    })
  })
})
