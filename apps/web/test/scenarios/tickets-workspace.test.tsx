// tickets-workspace (#941), each fenced scenario of
// openspec/specs/tickets-workspace/spec.md step by step: Tickets' own page
// rendered in jsdom against the real in-process server. Tickets fills the
// shared app navigation (`<featherbase-sidebar>`) with its views and types;
// the shared top bar is the platform's, drawn around the page when it is
// served, so it is not part of this page.
import { screen, waitFor, within } from '@testing-library/react'
import { describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { scenarioFor } from 'server/test/scenario'
import { pinning, Tickets, TicketTypes, type Ticket } from 'server/test/tickets-world'
import { test as base, expect, type Session } from '../pg-test'
import { openTickets, sidebar } from '../tickets-page'

const test = base.extend(pinning)
const scenario = scenarioFor(test, 'tickets-workspace')
const SIDEBAR = 'featherbase-sidebar'
const BAR = 'featherbase-bar'
const NO_CONNECTIONS = "none of Tickets' outside connections is set up"
const SETTINGS_LINK = /\/featherbase\/admin\/table\/app-setting/
type Titled = Ticket & { title: string }

/** A ticket Anjali raised, assigned by support when an assignee is named. */
async function ticket(t: Tickets, kind: string, title: string, details: Record<string, unknown>, assignee?: string): Promise<Titled> {
  await t.create(kind, details, title)
  if (assignee) await t.action('edit', { assigned_to: t.ids[assignee] }, 'Support')
  return { ...t.ticket, title }
}
const ACCESS = { email: 'anjali@example.com', scope: 'Gold sales, read only' }

/** A row of the shared navigation, by its name. */
const navRow = (name: RegExp) => [...sidebar().querySelectorAll(':scope > :is(button, a)')].find(el => name.test(el.textContent ?? '')) as HTMLElement | undefined
/** The text of the app's own page: the shared bar and navigation left out. */
function ownText() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => node.nodeType === 1
      ? ((node as Element).matches(`${BAR}, ${SIDEBAR}, script, style`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP)
      : NodeFilter.FILTER_ACCEPT,
  })
  const parts: string[] = []
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '')
  return parts.join(' ').replace(/\s+/g, ' ')
}
const queueRows = (title: string) => within(screen.getByRole('main')).queryAllByRole('button').filter(el => el.textContent?.includes(title))
async function expectQueue(shown: Titled, hidden: Titled) {
  await waitFor(() => {
    expect(queueRows(shown.title).length, `the queue shows "${shown.title}"`).toBeGreaterThan(0)
    expect(queueRows(hidden.title), `the queue still shows "${hidden.title}"`).toHaveLength(0)
  }, { timeout: 8000 })
}
/** The ticket's header: the nearest box around its title that names its assignee. */
function header(title: string) {
  const heading = within(screen.getByRole('main')).getAllByRole('heading').find(h => h.textContent?.trim() === title && !h.closest(`${BAR}, ${SIDEBAR}`))
  expect(heading, `a heading for "${title}"`).toBeTruthy()
  let box = heading!.parentElement
  while (box && box.tagName !== 'MAIN' && !/Assigned to/.test(box.textContent ?? '')) box = box.parentElement
  const named = !!box && box.tagName !== 'MAIN'
  const actions = named ? [...box!.querySelectorAll('button')]
    .filter(b => b.getAttribute('role') !== 'tab' && !b.closest('[role=tablist]') && !b.disabled).map(b => b.textContent?.trim()) : []
  return { heading: heading!, box: named ? box! : null, actions }
}
async function statusLinks() {
  await waitFor(() => expect(within(sidebar()).getByText(/not set up/i)).toBeInTheDocument())
  return [...sidebar().querySelectorAll('a')].map(a => a.getAttribute('href') ?? '')
}

describe('tickets-workspace', () => {
  scenario('Moving between views in the shared navigation', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    let session!: Session
    let mine: Titled, theirs: Titled
    await step('the user is support staff with tickets assigned to them', async () => {
      await t.choose('Support')
      mine = await ticket(t, 'access', 'Assigned access', ACCESS, 'Support')
      theirs = await ticket(t, 'report', 'Colleague report', { format: 'Excel' }, 'Bala')
    })
    await step('the user opens Tickets', async () => {
      ;({ session } = await openTickets(t.people.Support!))
    })
    await step("Tickets' views are listed in the shared app navigation", async () => {
      expect(sidebar(), 'the page draws the shared app navigation').toBeTruthy()
      for (const view of [/^\s*All tickets/, /^\s*My requests/, /^\s*Assigned to me/])
        await waitFor(() => expect(navRow(view), `the shared navigation lists ${view}`).toBeTruthy())
    })
    await step('Tickets shows no navigation or account controls of its own', () => {
      const own = [...document.querySelectorAll('nav, [role=navigation], aside')].filter(el => !el.closest(`${BAR}, ${SIDEBAR}`))
      expect(own.map(el => el.outerHTML.slice(0, 80)), 'Tickets draws navigation of its own').toEqual([])
      expect(ownText(), 'Tickets draws account controls of its own').not.toMatch(/Signed in|Sign out|Support workspace|Requester workspace/)
    })
    await step('the user chooses the view of tickets assigned to them', () =>
      session.within(SIDEBAR, (nav) => nav.clickButton('Assigned to me')))
    await step('the queue shows only the tickets assigned to the user', () => expectQueue(mine, theirs))
  })

  scenario('Narrowing the queue to one ticket type', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    let access: Titled, dataQuality: Titled
    await step('the queue holds an access request and a data quality issue', async () => {
      await t.choose('Support')
      access = await ticket(t, 'access', 'Access in queue', ACCESS)
      const types = new TicketTypes(t)
      await types.configure()
      const title = 'Data quality in queue'
      await t.action('create', { title, original: title, kind: types.key, details: { urgency: 'Now' } }, 'Anjali')
      dataQuality = { ...t.ticket, title }
    })
    await step('the user chooses the access request type in the shared app navigation', async () => {
      const { session } = await openTickets(t.people.Support!)
      await session.within(SIDEBAR, (nav) => nav.clickButton('Access'))
    })
    await step('the queue shows the access request and not the data quality issue', () => expectQueue(access, dataQuality))
  })

  scenario('The ticket and its actions are at the top', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    let selected: Titled
    await step('the user is support staff and a new access ticket waits in the queue', async () => {
      await t.choose('Support')
      selected = await ticket(t, 'access', 'New access', ACCESS)
    })
    await step('the user opens Tickets and selects that ticket', async () => {
      const { session } = await openTickets(t.people.Support!)
      await session
        .within('main', (page) => page.clickButton(selected.title))
        .until('the ticket header names its assignee', () => header(selected.title).box)
    })
    await step("the ticket's title, state and assignee are shown at the top of the page", () => {
      const { box } = header(selected.title)
      expect(box, 'the ticket header shows who it is assigned to ("Assigned to")').toBeTruthy()
      expect(box!.textContent).toMatch(new RegExp(selected.ticket_state, 'i'))
      // No introductory text sits above the work: the page opens on the queue's toolbar.
      const main = screen.getByRole('main')
      expect(main.firstElementChild?.className).toBe('toolbar')
    })
    await step('the actions the user can take on it now are offered beside them', () => {
      const { box, actions } = header(selected.title)
      expect(box).toBeTruthy()
      expect(actions.length, 'an action is offered beside the ticket title, state and assignee').toBeGreaterThan(0)
    })
  })

  scenario('Unconfigured connections show as a short status', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step(NO_CONNECTIONS, () => t.choose('Support'))
    await step('the user opens Tickets', () => openTickets(t.people.Support!))
    await step('a short status in the navigation says the connections are not set up', async () => {
      const status = await waitFor(() => within(sidebar()).getByText(/not set up/i))
      expect((status.textContent ?? '').trim().length, 'the connection status is short').toBeLessThanOrEqual(80)
    })
    await step('no connections banner is shown above the queue', () =>
      expect(ownText(), 'a connections banner is shown on the page').not.toMatch(/Connections|Unconfigured|not set up|Employee lookup|Inbound email/i))
  })

  scenario('Only someone who can change the settings is led to them', async ({ admin, createUser }, step) => {
    const t = new Tickets(admin, createUser)
    await step(NO_CONNECTIONS, () => t.choose('Support'))
    await step('a System Manager opens Tickets', () => openTickets(admin as TestClient))
    await step("the status leads to Tickets' settings", async () => {
      const hrefs = await statusLinks()
      expect(hrefs.some(href => SETTINGS_LINK.test(href)), `the status leads nowhere near Tickets' settings: ${JSON.stringify(hrefs)}`).toBe(true)
    })
    await step('the user opens Tickets', () => openTickets(t.people.Support!))
    await step('the status leads nowhere', async () => expect(await statusLinks(), 'the status offers a link this person cannot open').toEqual([]))
  })
})
