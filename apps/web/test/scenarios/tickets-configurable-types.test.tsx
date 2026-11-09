// tickets-configurable-types (#912), the fenced scenarios a person reads on
// Tickets' own page, step by step, rendered in jsdom against the real
// in-process server; the rest are in apps/server/test/scenarios/.
import { screen, within } from '@testing-library/react'
import { describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { pinning, Tickets, TicketTypes } from 'server/test/tickets-world'
import { test as base, expect, type Session } from '../pg-test'
import { openTickets, selectTicket, sidebar } from '../tickets-page'

const test = base.extend(pinning)
const scenario = scenarioFor(test, 'tickets-configurable-types')

/** Opens the New ticket form and picks a request type, offered by its key. */
function openNewTicket(session: Session, key: string): Session {
  return session
    .clickButton('New ticket')
    .until('the New ticket form is open', () => screen.queryByRole('dialog'))
    // The type is chosen by its key, the option's value: selectOption picks by the option's text.
    .step('choose the request type', ({ user }) =>
      user.selectOptions(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Request type' }), key))
}

describe('tickets-configurable-types', () => {
  scenario('The configured type is offered in the sidebar and the form', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    const x = new TicketTypes(t)
    let session!: Session
    await step('a System Manager has configured a "Data Quality Issue" type with a required Urgency of Now or Later', () => x.configure())
    await step('Anjali opens Tickets', async () => {
      expect((await t.call('Anjali', '/api/app_reads/tickets/session', { payload: {} })).status).toBe(200)
      ;({ session } = await openTickets(t.people.Anjali))
    })
    await step('that type is listed under Request types and offered in the new-ticket form', async () => {
      await session.within('featherbase-sidebar', (nav) => nav.assertText('Data Quality Issue'))
      // A button, by role: the DSL has no verb for "this button is offered".
      expect(within(sidebar()).getByRole('button', { name: /Data Quality Issue/ })).toBeInTheDocument()
      await openNewTicket(session, x.key).within('dialog', (form) => form.assertText('Urgency *'))
    })
  })

  scenario('Dates on the ticket page read day, month name and year', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    const x = new TicketTypes(t)
    let session!: Session
    await step('Anjali submitted a Data Quality Issue raised on "2026-11-04"', () => x.submit({ urgency: 'Now', raised_on: '2026-11-04' }))
    await step("Anjali opens that ticket's page", async () => {
      ;({ session } = await openTickets(t.people.Anjali))
      await selectTicket(session, t.ticket.row_id).assertText('Original message')
    })
    await step('its raised-on date reads "04-Nov-2026" and no date on the page is written with slashes', async () => {
      await session.within('main', (page) => page.assertText('04-Nov-2026'))
      // No date with slashes anywhere: a pattern, which the DSL's text verbs don't take.
      expect(screen.getByRole('main').textContent ?? '').not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    })
  })

  scenario('An issue is raised for someone who never used Tickets', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    const x = new TicketTypes(t)
    await step('a person who never used Tickets, whom Pat may see and Anjali may not', async () => {
      await x.configure()
      await x.reader('Pat')
      await x.outsider()
    })
    await step('Pat raises a Data Quality Issue for that person', () => x.submit({ urgency: 'Now', raised_for: x.outsiderId }, 'Pat'))
    await step("the ticket shows that person's name, and Pat's form finds them by name", async () => {
      expect((await t.read('detail', { row_id: t.ticket.row_id }, 'Pat')).names[x.outsiderId]).toBe(x.outsiderName)
      const { session } = await openTickets(t.people.Pat)
      await openNewTicket(session, x.key)
        .within('dialog', (form) => form.fillIn('Search by name', x.outsiderName).assertText(x.outsiderName))
      // An option, by role: the name must be offered as a choice, not only written somewhere.
      expect(within(screen.getByRole('dialog')).getByRole('option', { name: new RegExp(x.outsiderName) })).toBeInTheDocument()
    })
    await step('the same issue from Anjali is refused', async () => {
      await x.submit({ urgency: 'Now', raised_for: x.outsiderId }, 'Anjali', true)
      expect(t.last.status).toBe(417)
    })
  })
})
