// tickets-type-transitions (#918), the fenced scenario a person takes on
// Tickets' own page, step by step, rendered in jsdom against the real
// in-process server; the rest are in apps/server/test/scenarios/.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { pinning, plan, Tickets, TicketTransitions } from 'server/test/tickets-world'
import { test as base, expect } from '../pg-test'
import { openTickets, selectTicket } from '../tickets-page'

const test = base.extend(pinning)
const scenario = scenarioFor(test, 'tickets-type-transitions')
const nextStep = () => screen.getByRole('heading', { name: 'Next step' }).closest('section') as HTMLElement

describe('tickets-type-transitions', () => {
  scenario('The assignee confirms a fix plan', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    const user = userEvent.setup()
    await step('a Data Quality Issue type whose assignee confirms a raised issue with what will be fixed, where, and a target date', () => x.configure())
    await step('Anjali raised a Data Quality Issue for SAP, assigned to Bala', () => x.raise())
    await step('Bala opens that ticket', async () => {
      await openTickets(t.people.Bala)
      await selectTicket(user, t.ticket.row_id)
      await waitFor(() => expect(document.querySelector('.ticket-kicker')).toBeTruthy())
      await user.click(screen.getByRole('tab', { name: 'Workflow' }))
      await screen.findByRole('heading', { name: 'Next step' })
    })
    await step('Bala is offered to confirm it, and Anjali is not', async () => {
      expect(within(screen.getByRole('group', { name: 'Actions on this ticket' })).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
      expect(await x.offered('Anjali')).toEqual([])
    })
    await step('Bala confirms it without a target date', () => x.take('Bala', 'Confirm', { fix_what: plan.fix_what, fix_where: plan.fix_where }, true))
    await step('the confirmation is refused as missing the target date', () => {
      expect(t.last.status).toBe(417)
      expect(JSON.stringify(t.last.body)).toMatch(/Target date is required/)
    })
    await step('Bala confirms it with what will be fixed, where, and a target date', async () => {
      await user.click(within(nextStep()).getByRole('button', { name: 'Confirm' }))
      await user.type(screen.getByLabelText('What will be fixed *'), plan.fix_what)
      await user.type(screen.getByLabelText('Where it will be fixed *'), plan.fix_where)
      fireEvent.change(screen.getByLabelText('Target date *'), { target: { value: plan.target_date } })
      await user.click(within(nextStep().querySelector('form') as HTMLElement).getByRole('button', { name: 'Confirm' }))
      await waitFor(() => expect(document.querySelector('.ticket-kicker')).toHaveTextContent(/Fix Planned/i), { timeout: 8000 })
      t.ticket = (await t.open('Bala')).ticket
    })
    await step('the ticket is in "Fix planned"', async () => expect((await t.open('Support')).ticket.ticket_state).toBe('Fix planned'))
  })
})
