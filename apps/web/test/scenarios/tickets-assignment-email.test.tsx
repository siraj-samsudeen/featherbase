// tickets-assignment-email (#1001, #1069), the fenced scenarios on Tickets'
// ticket screen, step by step, rendered in jsdom against the real in-process
// server; what the Email Queue alone proves is in apps/server/test/scenarios/.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { settleSandboxRequests } from 'server/test/pg-test-shared'
import { pinning, Tickets, TicketsAssignmentEmail } from 'server/test/tickets-world'
import { test as base, expect } from '../pg-test'
import { openTickets } from '../tickets-page'

const test = base.extend(pinning)
const scenario = scenarioFor(test, 'tickets-assignment-email')
const RAISED = 'Anjali has raised a ticket that support can assign'
const LISTED = 'Colleague is listed as someone tickets can be assigned to'

const picker = () => screen.getByRole('combobox', { name: 'Assigned to' }) as HTMLSelectElement
const confirmRow = () => screen.queryByRole('group', { name: 'Confirm the assignee' })
const chosen = () => picker().selectedOptions[0]?.textContent

/** That person's ticket screen, open on this ticket. */
async function openOnScreen(x: TicketsAssignmentEmail, actor: string) {
  await openTickets(x.t.people[actor]!, `?ticket=${x.t.ticket.row_id}`)
  await screen.findByRole('heading', { name: x.title }, { timeout: 8000 })
}
async function pick(x: TicketsAssignmentEmail, user: ReturnType<typeof userEvent.setup>, name: string) {
  await openOnScreen(x, 'Support')
  await user.selectOptions(picker(), x.t.ids[name]!)
}
async function mail(x: TicketsAssignmentEmail) {
  await settleSandboxRequests()
  return x.t.mail()
}

describe('tickets-assignment-email', () => {
  scenario('Assigning on the ticket screen', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    const user = userEvent.setup()
    await step(RAISED, async () => {
      // The queue lists tickets by id: an earlier one comes first, so only the link can choose Anjali's.
      await x.t.setup()
      await x.t.action('create', { title: 'An earlier ticket', original: 'An earlier ticket', kind: 'generic', details: {} }, 'Bala')
      await x.raise()
    })
    await step(LISTED, () => x.assignable('Colleague'))
    await step('support assigns the ticket to Colleague on the ticket screen', async () => {
      await pick(x, user, 'Colleague')
      await user.click(within(confirmRow()!).getByRole('button', { name: 'Assign' }))
      await waitFor(async () => expect((await mail(x)).length).toBeGreaterThan(0), { timeout: 8000 })
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
      await openTickets(x.t.people.Colleague!, link.search)
      // After the queue has loaded, and it isn't the first ticket in it: the link chose it.
      await waitFor(() => expect(screen.queryByText('Loading queue')).toBeNull(), { timeout: 8000 })
      expect(await screen.findByRole('heading', { name: x.title }, { timeout: 8000 })).toBeInTheDocument()
    })
  })

  scenario('Picking a person asks before anything is saved', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    const user = userEvent.setup()
    await step(RAISED, () => x.raise())
    await step(LISTED, () => x.assignable('Colleague'))
    await step('support picks Colleague as the assignee on the ticket screen', () => pick(x, user, 'Colleague'))
    await step('the ticket screen asks "Assign to Colleague and email them?"', () => {
      // The scenario names people by their part; the screen shows the name the picker lists.
      const name = picker().querySelector(`option[value="${x.t.ids.Colleague}"]`)!.textContent!.trim()
      expect(within(confirmRow()!).getByText(`Assign to ${name} and email them?`, { exact: true })).toBeInTheDocument()
    })
    await step('nobody is emailed about the ticket', async () => expect(await mail(x)).toEqual([]))
  })

  scenario('Cancelling keeps the ticket as it was', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    const user = userEvent.setup()
    await step(RAISED, () => x.raise())
    await step(LISTED, () => x.assignable('Colleague'))
    await step('support picks Colleague as the assignee on the ticket screen', () => pick(x, user, 'Colleague'))
    await step('support cancels the assignment', async () => {
      await user.click(within(confirmRow()!).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(confirmRow()).toBeNull())
    })
    await step('the ticket screen shows the ticket as Unassigned', async () => {
      expect(chosen()).toBe('Unassigned')
      await openOnScreen(x, 'Support')
      expect(chosen()).toBe('Unassigned')
    })
    await step('nobody is emailed about the ticket', async () => expect(await mail(x)).toEqual([]))
  })

  scenario('The requester sees the assignee as text', async ({ admin, createUser }, step) => {
    const x = new TicketsAssignmentEmail(new Tickets(admin, createUser))
    await step(RAISED, () => x.raise())
    await step('Anjali opens her ticket on the ticket screen', () => openOnScreen(x, 'Anjali'))
    await step('Anjali sees the ticket as Unassigned, with no way to assign it', () => {
      const facts = document.querySelector('header.ticket-header .ticket-facts') as HTMLElement
      expect(within(facts).getByText('Unassigned', { exact: true })).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'Assigned to' })).toBeNull()
    })
  })
})
