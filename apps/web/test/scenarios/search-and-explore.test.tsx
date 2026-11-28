// search-and-explore's scenarios (#1070): navigation history, Linked to
// filters (#1276) and the relationship map as a person reads them, the real Admin in jsdom
// against the in-process server. Each test is one fenced scenario of the
// effective spec (openspec/specs/search-and-explore and the active change
// issue-910-relational-navigation), step by step.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, vi } from 'vitest'
import { rowHref, tableHref } from 'shared'
import { sql } from 'server/src/db'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp, onScreen, byTestId } from '../pg-test'

configure({ asyncUtilTimeout: 10_000 })
type Client = Parameters<typeof renderApp>[1]
type Rendered = Awaited<ReturnType<typeof renderApp>>
type Router = { state: { location: { pathname: string; href: string } } }
const scenario = scenarioFor(test, 'search-and-explore')
const location = (r: Rendered) => (r.router as unknown as Router).state.location
const bar = () => screen.getByRole('textbox', { name: 'Search or type a command' }) as HTMLInputElement

/** Watch the page's own requests whose path is `path`: hold, fail or just see them. */
function onRequest(path: string, handle: (respond: () => Promise<Response>) => Promise<Response>) {
  const real = globalThis.fetch
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url), 'http://localhost')
    return url.pathname === path ? handle(() => real(input, init)) : real(input, init)
  })
}

// ---- Navigation history: a person who manages the instance, their recents and the instance's ----

class History {
  view: Rendered | null = null
  release: () => void = () => {}
  private spy: ReturnType<typeof onRequest> | null = null
  constructor(private person: Client) {}

  private get key() {
    return `fc-recents:${this.person.user}`
  }

  /** Render the Admin and wait for its history summary to be answered. */
  private async load(summary: Promise<unknown>) {
    this.view = await renderApp('/featherbase/admin', this.person)
    await summary
    await screen.findByTestId('admin-sidebar')
  }

  private answered() {
    this.spy?.mockRestore()
    let seen!: () => void
    const done = new Promise<void>((r) => (seen = r))
    this.spy = onRequest('/api/events/summary', async (respond) => {
      const res = await respond()
      seen()
      return res
    })
    return done
  }

  async open() {
    await this.load(this.answered())
  }

  remember(label = 'Person') {
    localStorage.setItem(this.key, JSON.stringify([{
      kind: 'list', key: `list:${label}?`, label, path: tableHref(label), visits: [Date.now() - 2000, Date.now() - 1000],
    }]))
  }

  async forget() {
    await sql.unsafe('delete from featherbase.user_event where created_by = $1', [this.person.user!])
  }

  async savePersonVisit() {
    await this.person.post('/api/events', {
      events: [{ kind: 'list', key: 'list:Person?', label: 'Person', path: tableHref('Person'), at: Date.now() - 1000 }],
    })
  }

  async reload() {
    this.view?.unmount()
    await this.load(this.answered())
  }

  /** Reload with the summary's answer held until `release()`. */
  async holdSummary() {
    this.view?.unmount()
    this.spy?.mockRestore()
    const gate = new Promise<void>((r) => (this.release = r))
    let captured!: () => void
    const held = new Promise<void>((r) => (captured = r))
    let delivered!: () => void
    this.delivered = new Promise<void>((r) => (delivered = r))
    this.spy = onRequest('/api/events/summary', async (respond) => {
      const res = await respond()
      captured()
      await gate
      queueMicrotask(delivered)
      return res
    })
    await this.load(held)
  }
  delivered: Promise<void> = Promise.resolve()

  async visitPerson(user: ReturnType<typeof userEvent.setup>) {
    // A client navigation keeps the first summary in flight.
    await user.type(bar(), 'Person')
    const link = await waitFor(() => {
      const hit = screen.getAllByTestId('awesomebar-table').find((e) => e.getAttribute('href') === tableHref('Person'))
      expect(hit).toBeDefined()
      return hit!
    })
    await user.click(link)
    await waitFor(() => expect(location(this.view!).pathname).toMatch(/\/admin\/table\/person$/))
    await waitFor(() =>
      expect((JSON.parse(localStorage.getItem(this.key) ?? '[]') as { label: string }[]).some((e) => e.label === 'Person')).toBe(true))
    this.release()
    await this.delivered
  }

  async failSummary() {
    this.view?.unmount()
    this.spy?.mockRestore()
    this.spy = onRequest('/api/events/summary', () => Promise.reject(new TypeError('Failed to fetch')))
    this.view = await renderApp('/featherbase/admin', this.person)
    await screen.findByTestId('admin-sidebar')
  }

  /** Both navigation surfaces: the sidebar's recents and the empty command bar's. */
  async expectDestination(label: string, present: boolean) {
    const n = present ? 1 : 0
    await waitFor(() =>
      expect(document.querySelectorAll(`[data-testid="sidebar-recents"] a[href="${tableHref(label)}"]`)).toHaveLength(n))
    fireEvent.click(bar())
    fireEvent.focus(bar())
    fireEvent.change(bar(), { target: { value: '' } })
    await waitFor(() =>
      expect(screen.queryAllByTestId('awesomebar-recent').filter((e) => e.textContent?.includes(label))).toHaveLength(n))
  }
}

async function history(createUser: (o: { roles: string[] }) => Promise<Client>) {
  const h = new History(await createUser({ roles: ['System Manager'] }))
  await h.open()
  return h
}

// ---- Linked to filters and the map: made-up tables ----

const data = (column_name: string, label = 'Title') => ({ column_name, column_type: 'Data', label, in_list_view: true })
const link = (column_name: string, label: string, reference_table: string) =>
  ({ column_name, column_type: 'Reference', label, reference_table, in_list_view: true })

async function table(admin: Client, def: Record<string, unknown>, rows: Record<string, unknown>[] = []) {
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, ...def })
  for (const row of rows) await admin.post(`/api/table/${encodeURIComponent(String(def.name))}`, row)
}

/** Acme has two orders with three lines (100, 150, 100); Bolt Co one order with one line (999). */
async function seedPurchasing(admin: Client) {
  await table(admin, { name: 'Supplier', id_pattern: 'prompt', title_column: 'title', columns: [data('title')] },
    [{ row_id: 'sup-acme', title: 'Acme' }, { row_id: 'sup-bolt', title: 'Bolt Co' }])
  await table(admin, { name: 'Purchase Order', id_pattern: 'prompt', title_column: 'title',
    columns: [data('title'), link('supplier', 'Supplier', 'Supplier')] }, [
    { row_id: 'po-1', title: 'Acme order 1', supplier: 'sup-acme' },
    { row_id: 'po-2', title: 'Acme order 2', supplier: 'sup-acme' },
    { row_id: 'po-3', title: 'Bolt order 1', supplier: 'sup-bolt' },
  ])
  await table(admin, { name: 'PO Line', id_pattern: 'prompt', title_column: 'title',
    columns: [data('title'), link('purchase_order', 'Purchase Order', 'Purchase Order'),
      { column_name: 'amount', column_type: 'Int', label: 'Amount', in_list_view: true }] }, [
    { row_id: 'pol-1', title: 'Bolts', purchase_order: 'po-1', amount: 100 },
    { row_id: 'pol-2', title: 'Nuts', purchase_order: 'po-1', amount: 150 },
    { row_id: 'pol-3', title: 'Washers', purchase_order: 'po-2', amount: 100 },
    { row_id: 'pol-4', title: 'Screws', purchase_order: 'po-3', amount: 999 },
  ])
}

/** A list's Add filter, Linked to… and Not linked to… (#1276). */
class LinkedList {
  view!: Rendered
  async open(admin: Client, name: string) {
    this.view = await renderApp(`${tableHref(name)}?filters=${encodeURIComponent('[]')}`, admin)
    await screen.findByTestId('filter-toggle')
  }

  async start(choice: 'Linked to…' | 'Not linked to…') {
    fireEvent.click(screen.getByTestId('filter-toggle'))
    const field = await screen.findByTestId('filter-field')
    await within(field).findByRole('option', { name: choice })
    fireEvent.change(field, { target: { value: choice === 'Linked to…' ? '__linked_to' : '__not_linked_to' } })
  }

  /** Step n goes to the Table offered as `label`. */
  async to(n: number, label: string) {
    const select = await waitFor(() => {
      const hit = screen.getAllByTestId('linked-table')[n]
      expect(within(hit!).getByRole('option', { name: label })).toBeInTheDocument()
      return hit!
    })
    fireEvent.change(select, { target: { value: (within(select).getByRole('option', { name: label }) as HTMLOptionElement).value } })
    await waitFor(() => expect(within(screen.getAllByTestId('linked-step')[n]!).getByTestId('linked-step-count')).toBeInTheDocument())
  }

  async linkOn() {
    fireEvent.click(await screen.findByTestId('linked-link-on'))
  }

  async pick(n: number, name: string) {
    const choice = await waitFor(() => {
      const hit = within(screen.getAllByTestId('linked-step')[n]!).getAllByTestId('linked-choice').find((c) => c.textContent?.includes(name))
      expect(hit).toBeDefined()
      return hit!
    })
    fireEvent.click(within(choice).getByRole('checkbox'))
  }

  add() {
    fireEvent.click(screen.getByTestId('linked-add'))
  }

  /** The list's rows by their names, once they read `names`. */
  async shows(names: string[]) {
    await waitFor(() => expect([...document.querySelectorAll('tbody [data-title-cell]')].map((c) => c.textContent).sort()).toEqual(names.slice().sort()))
  }
}

async function linesOfAcme(admin: Client) {
  const list = new LinkedList()
  await list.open(admin, 'PO Line')
  await list.start('Linked to…')
  await list.to(0, 'Purchase Order')
  await list.linkOn()
  await list.to(1, 'Supplier')
  await list.pick(1, 'Acme')
  list.add()
  return list
}

/** Volunteers and the chores assigned to them. */
async function seedChores(admin: Client, opts: { checkedBy?: boolean } = {}) {
  await table(admin, { name: 'Volunteer', id_pattern: 'prompt', title_column: 'title',
    columns: [data('title'), data('phone', 'Phone')] })
  await table(admin, { name: 'Chore', id_pattern: 'prompt', title_column: 'title',
    columns: [data('title'), link('assigned_to', 'Assigned To', 'Volunteer'),
      // #1218: a second link back, so the map names which one joins the chores.
      ...(opts.checkedBy ? [link('checked_by', 'Checked By', 'Volunteer')] : [])] })
}

// The organisation masters of #910, as much as the map reads: Region ← Site Master ← Plant.
const SITE = 'Site Master'
async function seedOrganisation(admin: Client) {
  await table(admin, { name: 'Region', id_pattern: 'hash', title_column: 'name', columns: [data('name', 'Name')] })
  await table(admin, { name: SITE, id_pattern: 'hash', title_column: 'name',
    columns: [data('name', 'Name'), data('site_code', 'Site code'), link('region', 'Region', 'Region')] })
  await table(admin, { name: 'Plant', id_pattern: 'prompt', title_column: 'name',
    columns: [data('name', 'Name'), link('site', 'Site', SITE), data('business_line', 'Business line')] })
  const add = async (name: string, row: Record<string, unknown>) =>
    (await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent(name)}`, row)).row_id
  const region: Record<string, string> = {}
  for (const name of ['Kerala', 'Tamil Nadu']) region[name] = await add('Region', { name })
  const site: Record<string, string> = {}
  for (const [name, r, site_code] of [['Enchakkal', 'Kerala', 'EKL'], ['Attakulangara', 'Kerala', 'ATK'],
    ['Pazhavangadi', 'Kerala', 'PKD'], ['Tenkasi', 'Tamil Nadu', 'TKS']])
    site[name!] = await add(SITE, { name, site_code, region: region[r!] })
  for (const [row_id, name, s] of [['1503', 'Enchakkal Supermarket', 'Enchakkal'], ['1504', 'Enchakkal Textiles', 'Enchakkal'],
    ['1505', 'Enchakkal Hardware', 'Enchakkal'], ['1601', 'Attakulangara Store', 'Attakulangara']])
    await add('Plant', { row_id, name, site: site[s!], business_line: 'Retail' })
  return { region, site }
}

class RelationMap {
  async open(admin: Client, name: string, rowId: string) {
    await renderApp(rowHref(name, rowId), admin)
    await waitFor(() => expect(within(screen.getByRole('main')).getAllByRole('heading', { level: 1 })[0]).toBeInTheDocument())
    // A tab by its name: the DSL's attribute verbs read an element found by selector.
    const tab = await screen.findByRole('tab', { name: 'Map' })
    fireEvent.click(tab)
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'))
    await screen.findByTestId('map-center')
  }
  linkedRow = (name: string) => screen.findByTestId(`map-forward-${name}`)
  collection = (name: string) => screen.findByTestId(`map-group-${name}`)
  /** The collection of `name` joined by the link `link`, where its Table links here more than once. */
  collectionBy = (name: string, link: string) => waitFor(() => {
    const box = screen.getAllByTestId(`map-group-${name}`).find((g) => g.textContent?.includes(link))
    if (!box) throw new Error(`no ${name} collection by ${link}`)
    return box
  })
  /** A box's text, once `text` shows in it. */
  async boxText(box: Promise<HTMLElement>, text: string) {
    const el = await box
    await waitFor(() => expect(el).toHaveTextContent(text))
    return (el.textContent ?? '').trim()
  }
  /** A group's header, its name and count ("Plant 3"); #1282: its rows follow inside the box. */
  async header(name: string) {
    const box = await this.collection(name)
    return (await within(box).findByRole('button', { name: /\d$/ })).getAttribute('aria-label') ?? ''
  }
  centredOn = (title: string) => onScreen().within(byTestId('map-center'), (center) => center.assertText(title))
}

describe('search-and-explore', () => {
  // ---- Navigation history follows the current instance ----

  scenario('Old destinations disappear after history is cleared', async ({ createUser }, step) => {
    let h!: History
    await step('the user has remembered visits to the Person destination', async () => {
      h = await history(createUser)
      h.remember()
    })
    await step("the instance has forgotten the user's visits", () => h.forget())
    await step('the user reloads the app', () => h.reload())
    await step("the user's navigation history has no Person destination", () => h.expectDestination('Person', false))
  })

  scenario('Current history replaces old remembered destinations', async ({ createUser }, step) => {
    let h!: History
    await step('the browser remembers an old destination absent from the instance history', async () => {
      h = await history(createUser)
      h.remember('Old destination')
    })
    await step("the instance remembers the user's Person destination", () => h.savePersonVisit())
    await step('the user reloads the app', () => h.reload())
    await step("the user's navigation history contains Person but not the old destination", async () => {
      await h.expectDestination('Person', true)
      await h.expectDestination('Old destination', false)
    })
  })

  scenario('A new visit survives a history refresh', async ({ createUser }, step) => {
    const user = userEvent.setup()
    let h!: History
    await step("the user's history is loading", async () => {
      h = await history(createUser)
      await h.holdSummary()
    })
    await step('the user opens the Person destination before history finishes loading', () => h.visitPerson(user))
    await step("the Person destination remains in the user's navigation history", () => h.expectDestination('Person', true))
  })

  scenario('Old destinations never flash while history loads', async ({ createUser }, step) => {
    let h!: History
    await step('the browser remembers an old destination absent from the instance history', async () => {
      h = await history(createUser)
      h.remember('Old destination')
    })
    await step("the user's history is still loading", () => h.holdSummary())
    await step('neither navigation surface offers the old destination', async () => {
      try { await h.expectDestination('Old destination', false) }
      finally { h.release() }
    })
  })

  scenario('Remembered destinations remain usable when history fails', async ({ createUser }, step) => {
    let h!: History
    await step('the user has remembered visits to the Person destination', async () => {
      h = await history(createUser)
      h.remember()
    })
    await step('the initial history request fails', () => h.failSummary())
    await step('both navigation surfaces offer the Person destination', () => h.expectDestination('Person', true))
  })

  // ---- A list follows its links with Linked to filters (#1276) ----

  scenario("The lines of one supplier's orders", async ({ admin }, step) => {
    await step('Acme has two purchase orders with lines of 100, 150 and 100, and Bolt Co one order with a line of 999', () => seedPurchasing(admin))
    let list!: LinkedList
    await step('the user lists the PO Lines linked to Purchase Orders linked to the supplier Acme', async () => {
      list = await linesOfAcme(admin)
    })
    await step("the list shows Acme's three lines with a total of 350", async () => {
      await list.shows(['Bolts', 'Nuts', 'Washers'])
      await waitFor(() => expect(screen.getByTestId('list-sum')).toHaveTextContent(/Σ Amount: \D*350\b/))
    })
    await step('the Purchase Order step counts 2', async () => {
      await waitFor(() => expect(within(screen.getByTestId('filter-chip')).getByTestId('linked-words').getAttribute('title')).toMatch(/^Purchase Order: 2 linked/))
    })
  })

  scenario('Suppliers with no order', async ({ admin }, step) => {
    await step('Acme has two purchase orders, Bolt Co one, and Cord Ltd none', async () => {
      await seedPurchasing(admin)
      await admin.post('/api/table/Supplier', { row_id: 'sup-cord', title: 'Cord Ltd' })
    })
    const list = new LinkedList()
    await step('the user lists the Suppliers not linked to any Purchase Order', async () => {
      await list.open(admin, 'Supplier')
      await list.start('Not linked to…')
      await list.to(0, 'Purchase Order')
      list.add()
    })
    await step('the list shows only Cord Ltd', () => list.shows(['Cord Ltd']))
  })

  scenario('A shared Explore link', async ({ admin }, step) => {
    await step('Acme has two purchase orders with lines of 100, 150 and 100, and Bolt Co one order with a line of 999', () => seedPurchasing(admin))
    await step('the user opens an Explore link from Supplier through Purchase Order to PO Line with Acme picked', async () => {
      const chain = [{ mode: 'backlink', table: 'Purchase Order', column: 'supplier' }, { mode: 'backlink', table: 'PO Line', column: 'purchase_order' }]
      await renderApp(`/featherbase/admin/explore?root=Supplier&chain=${encodeURIComponent(JSON.stringify(chain))}&select=${encodeURIComponent('["sup-acme"]')}`, admin)
    })
    await step("the list of PO Lines shows Acme's three lines", () => new LinkedList().shows(['Bolts', 'Nuts', 'Washers']))
  })

  // ---- The relationship map shows one row's neighborhood ----

  scenario("Enchakkal's map", async ({ admin }, step) => {
    const map = new RelationMap()
    let org!: Awaited<ReturnType<typeof seedOrganisation>>
    await step('the site Enchakkal is in region Kerala and has three plants', async () => {
      org = await seedOrganisation(admin)
    })
    await step("the user opens the map on Enchakkal's page", () => map.open(admin, SITE, org.site.Enchakkal!))
    await step('the map shows Enchakkal pointing at Kerala', async () => {
      await map.centredOn('Enchakkal')
      expect(await map.boxText(map.linkedRow('Region'), 'Kerala')).toContain('Kerala')
    })
    await step('a group of 3 plants pointing back at Enchakkal', async () => {
      expect(await map.header('Plant')).toMatch(/\b3$/)
    })
  })

  scenario('Jump to a related row', async ({ admin }, step) => {
    const map = new RelationMap()
    await step("the user is looking at Enchakkal's map", async () => {
      const org = await seedOrganisation(admin)
      await map.open(admin, SITE, org.site.Enchakkal!)
    })
    await step('the user chooses to centre the map on the region Kerala', async () => {
      // #1282: Kerala's name on the map re-centres it there.
      fireEvent.click(await within(await map.linkedRow('Region')).findByRole('link', { name: 'Kerala' }))
    })
    await step('the map re-centres on Kerala, showing what it in turn points to and back from', async () => {
      await map.centredOn('Kerala')
      expect(await map.header(SITE)).toMatch(/\b3$/)
    })
  })

  // ---- The relationship map says how each row is related ----

  scenario(`A chore's assignee reads "Assigned To"`, async ({ admin }, step) => {
    const map = new RelationMap()
    await step('the user is a System Manager', () => {})
    await step('a table of volunteers and a table of chores, each chore assigned to a volunteer', () => seedChores(admin))
    await step('the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"', () => addChore(admin))
    await step("the user opens that chore's relationship map", () => map.open(admin, 'Chore', 'chore-1'))
    await step('the user sees "Asha", a Volunteer, linked by "Assigned To"', async () => {
      const text = await map.boxText(map.linkedRow('Volunteer'), 'Asha')
      for (const part of ['Asha', 'Volunteer', 'Assigned To']) expect(text).toContain(part)
    })
  })

  scenario(`Asha's chores read by "Assigned To"`, async ({ admin }, step) => {
    const map = new RelationMap()
    await step('the user is a System Manager', () => {})
    await step('a table of volunteers and a table of chores, each chore assigned to a volunteer and checked by a volunteer', () => seedChores(admin, { checkedBy: true }))
    await step('the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"', () => addChore(admin))
    await step("the user opens Asha's relationship map", () => map.open(admin, 'Volunteer', 'vol-1'))
    await step(`the user sees Asha's chores related by "Assigned To"`, async () => {
      const text = await map.boxText(map.collectionBy('Chore', 'Assigned To'), 'Assigned To')
      expect(text).toContain('Chore')
      expect(text).toContain('Assigned To')
      expect(text).not.toContain('assigned_to')
    })
  })
})

async function addChore(admin: Client) {
  await admin.post('/api/table/Volunteer', { row_id: 'vol-1', title: 'Asha', phone: '555-0142' })
  await admin.post('/api/table/Chore', { row_id: 'chore-1', title: 'Paint the fence', assigned_to: 'vol-1' })
}
