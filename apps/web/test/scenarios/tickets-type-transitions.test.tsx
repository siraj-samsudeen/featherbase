// tickets-type-transitions (#918), the fenced scenario a person takes on
// Tickets' own page, step by step, rendered in jsdom against the real
// in-process server; the rest are in apps/server/test/scenarios/.
import { fireEvent, screen, within } from '@testing-library/react'
import { describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { pinning, plan, Tickets, TicketTransitions } from 'server/test/tickets-world'
import { test as base, expect, type Session } from '../pg-test'
import { openTickets, selectTicket, ticketOpens } from '../tickets-page'

const test = base.extend(pinning)
const scenario = scenarioFor(test, 'tickets-type-transitions')

describe('tickets-type-transitions', () => {
  scenario('The assignee confirms a fix plan', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    let session!: Session
    await step('a Data Quality Issue type whose assignee confirms a raised issue with what will be fixed, where, and a target date', () => x.configure())
    await step('Anjali raised a Data Quality Issue for SAP, assigned to Bala', () => x.raise())
    await step('Bala opens that ticket', async () => {
      ;({ session } = await openTickets(t.people.Bala))
      await ticketOpens(selectTicket(session, t.ticket.row_id))
        .clickButton('Workflow')
        .assertText('Next step')
    })
    await step('Bala is offered to confirm it, and Anjali is not', async () => {
      // A button, by role: the DSL has no verb for "this button is offered".
      expect(within(screen.getByRole('group', { name: 'Actions on this ticket' })).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
      expect(await x.offered('Anjali')).toEqual([])
    })
    await step('Bala confirms it without a target date', () => x.take('Bala', 'Confirm', { fix_what: plan.fix_what, fix_where: plan.fix_where }, true))
    await step('the confirmation is refused as missing the target date', () => {
      expect(t.last.status).toBe(417)
      expect(JSON.stringify(t.last.body)).toMatch(/Target date is required/)
    })
    await step('Bala confirms it with what will be fixed, where, and a target date', async () => {
      await session
        .within('.ticket-actions .actions', (moves) => moves.clickButton('Confirm'))
        .fillIn('What will be fixed', plan.fix_what)
        .fillIn('Where it will be fixed', plan.fix_where)
        // A date input takes its value whole; typing it key by key is not how jsdom fills one.
        .step('set the target date', async () => { fireEvent.change(screen.getByLabelText('Target date *'), { target: { value: plan.target_date } }) })
        .within('#action-transition', (form) => form.clickButton('Confirm'))
        .within('.ticket-kicker', (kicker) => kicker.assertText('Fix Planned'))
      t.ticket = (await t.open('Bala')).ticket
    })
    await step('the ticket is in "Fix planned"', async () => expect((await t.open('Support')).ticket.ticket_state).toBe('Fix planned'))
  })
})
