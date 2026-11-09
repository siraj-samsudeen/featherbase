// tickets-configurable-types (#912), the fenced scenarios a person reads on
// Tickets' own page, step by step, rendered in jsdom against the real
// in-process server; the rest are in apps/server/test/scenarios/.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { pinning, Tickets, TicketTypes } from 'server/test/tickets-world'
import { test as base, expect } from '../pg-test'
import { openTickets, selectTicket, sidebar } from '../tickets-page'

const test = base.extend(pinning)
const scenario = scenarioFor(test, 'tickets-configurable-types')

async function openNewTicket(user: ReturnType<typeof userEvent.setup>, key: string) {
  await user.click(screen.getAllByRole('button', { name: /New ticket/ })[0])
  const dialog = await screen.findByRole('dialog')
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Request type' }), key)
  return dialog
}

describe('tickets-configurable-types', () => {
  scenario('The configured type is offered in the sidebar and the form', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    const x = new TicketTypes(t)
    const user = userEvent.setup()
    await step('a System Manager has configured a "Data Quality Issue" type with a required Urgency of Now or Later', () => x.configure())
    await step('Anjali opens Tickets', async () => {
      expect((await t.call('Anjali', '/api/app_reads/tickets/session', { payload: {} })).status).toBe(200)
      await openTickets(t.people.Anjali)
    })
    await step('that type is listed under Request types and offered in the new-ticket form', async () => {
      await waitFor(() => expect(within(sidebar()).getByRole('button', { name: /Data Quality Issue/ })).toBeInTheDocument())
      const dialog = await openNewTicket(user, x.key)
      expect(within(dialog).getByText('Urgency *')).toBeInTheDocument()
    })
  })

  scenario('Dates on the ticket page read day, month name and year', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    const x = new TicketTypes(t)
    const user = userEvent.setup()
    await step('Anjali submitted a Data Quality Issue raised on "2026-11-04"', () => x.submit({ urgency: 'Now', raised_on: '2026-11-04' }))
    await step("Anjali opens that ticket's page", async () => {
      await openTickets(t.people.Anjali)
      await selectTicket(user, t.ticket.row_id)
      await screen.findByRole('heading', { name: 'Original message' })
    })
    await step('its raised-on date reads "04-Nov-2026" and no date on the page is written with slashes', () => {
      const text = screen.getByRole('main').textContent ?? ''
      expect(text).toContain('04-Nov-2026')
      expect(text).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    })
  })

  scenario('An issue is raised for someone who never used Tickets', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    const x = new TicketTypes(t)
    const user = userEvent.setup()
    await step('a person who never used Tickets, whom Pat may see and Anjali may not', async () => {
      await x.configure()
      await x.reader('Pat')
      await x.outsider()
    })
    await step('Pat raises a Data Quality Issue for that person', () => x.submit({ urgency: 'Now', raised_for: x.outsiderId }, 'Pat'))
    await step("the ticket shows that person's name, and Pat's form finds them by name", async () => {
      expect((await t.read('detail', { row_id: t.ticket.row_id }, 'Pat')).names[x.outsiderId]).toBe(x.outsiderName)
      await openTickets(t.people.Pat)
      const dialog = await openNewTicket(user, x.key)
      await user.type(within(dialog).getByRole('searchbox'), x.outsiderName)
      await waitFor(() => expect(within(dialog).getByRole('option', { name: new RegExp(x.outsiderName) })).toBeInTheDocument(), { timeout: 5000 })
    })
    await step('the same issue from Anjali is refused', async () => {
      await x.submit({ urgency: 'Now', raised_for: x.outsiderId }, 'Anjali', true)
      expect(t.last.status).toBe(417)
    })
  })
})
