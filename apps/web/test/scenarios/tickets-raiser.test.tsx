// tickets-raiser (#963), the fenced scenario support reads on Tickets' own
// page, step by step, rendered in jsdom against the real in-process server;
// the rest are in apps/server/test/scenarios/.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { pinning, Tickets, TicketTransitions } from 'server/test/tickets-world'
import { test as base, expect } from '../pg-test'
import { openTickets, selectTicket } from '../tickets-page'

const test = base.extend(pinning)
const scenario = scenarioFor(test, 'tickets-raiser')
const REASON = 'Anjali only keyed it in'

describe('tickets-raiser', () => {
  scenario('Support reads who changed the raiser and why', async ({ admin, createUser }, step) => {
    const x = new TicketTransitions(new Tickets(admin, createUser))
    const t = x.t
    const user = userEvent.setup()
    await step('Anjali raised a Data Quality Issue for SAP, assigned to Bala', () => x.raise())
    await step(`a System Manager changes the raiser to Colleague because "${REASON}"`, () => t.changeRaiser('Manager', 'Colleague', REASON))
    await step("support opens the ticket's activity", async () => {
      await openTickets(t.people.Support)
      await selectTicket(user, t.ticket.row_id)
      await waitFor(() => expect(document.querySelector('.ticket-kicker')).toBeTruthy())
      await user.click(screen.getByRole('tab', { name: 'Activity' }))
    })
    await step('the history names Anjali, Colleague and the System Manager, and gives the reason', async () => {
      const event = await waitFor(() => {
        const found = [...document.querySelectorAll('.event')].find(el => el.textContent?.includes('Change Raiser'))
        expect(found, 'a Change Raiser event').toBeTruthy()
        return found!
      })
      const text = event.textContent ?? ''
      for (const expected of ['Old Raiser', 'New Raiser', 'Anjali', 'Colleague', 'Manager', REASON]) expect(text).toContain(expected)
      for (const id of [t.ids.Anjali, t.ids.Colleague, t.ids.Manager]) expect(text, 'a raw id is shown').not.toContain(id)
    })
  })
})
