// search-and-explore's scenarios (#1070): navigation history, Explore and
// the relationship map as a person reads them, the real Admin in jsdom
// against the in-process server. Each test is one fenced scenario of the
// effective spec (openspec/specs/search-and-explore and the active change
// issue-910-relational-navigation), step by step.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, vi } from 'vitest'
import { rowHref, tableHref } from 'shared'
import { sql } from 'server/src/db'
import { patchDoc } from 'server/test/fixtures'
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

// ---- Explore and the map: made-up tables ----

const data = (column_name: string, label = 'Title') => ({ column_name, column_type: 'Data', label, in_list_view: true })
const link = (column_name: string, label: string, reference_table: string) =>
  ({ column_name, column_type: 'Reference', label, reference_table, in_list_view: true })

async function table(admin: Client, def: Record<string, unknown>, rows: Record<string, unknown>[] = []) {
  await admin.post('/api/table_def', def)
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

class Explore {
  view!: Rendered
  async open(admin: Client) {
    this.view = await renderApp('/featherbase/admin/explore', admin)
    await screen.findByTestId('explore-root')
  }

  /** Types into the table search and presses Enter, once the search has narrowed to a match. */
  async searchAndStart(user: ReturnType<typeof userEvent.setup>, text: string) {
    await onScreen().fillIn('Find a table', text)
    // The options read whole, the first by pattern: the DSL reads text, not option lists.
    await waitFor(() => {
      const options = within(screen.getByTestId('explore-root')).getAllByRole('option')
      expect(options[0]!.textContent).toMatch(/^\d+ matching tables?/)
      expect(options.length).toBeGreaterThan(1)
    })
    await onScreen().pressKey('Enter')
  }

  async startingTable() {
    await waitFor(() => expect(location(this.view).href).toMatch(/[?&]root=/))
    return (screen.getByTestId('explore-root') as HTMLSelectElement).value
  }

  async startFrom(name: string) {
    // Waits for the table to be offered: selectOption looks for its option once.
    const root = screen.getByTestId('explore-root') as HTMLSelectElement
    await waitFor(() => expect(within(root).getAllByRole('option').some((o) => o.textContent === name)).toBe(true))
    await onScreen().selectOption('Start from', name)
    await screen.findByTestId('explore-pane1')
  }

  // Every step picker is labelled "Then", and its option is matched by pattern: both raw.
  async addStep(n: number, name: string) {
    const picker = await screen.findByTestId(`explore-step${n}`)
    const option = await waitFor(() => {
      const hit = within(picker).getAllByRole<HTMLOptionElement>('option').find((o) => new RegExp(`^${name}\\b`).test(o.textContent ?? ''))
      expect(hit).toBeDefined()
      return hit!
    })
    fireEvent.change(picker, { target: { value: option.value } })
    await screen.findByTestId(`explore-pane${n}`)
  }

  rows(n: number) {
    return within(screen.getByTestId(`explore-pane${n}`)).queryAllByTestId('explore-row')
  }

  async clickRow(user: ReturnType<typeof userEvent.setup>, n: number, text: string) {
    const row = await waitFor(() => {
      const hit = this.rows(n).find((r) => r.textContent?.includes(text))
      expect(hit).toBeDefined()
      return hit!
    })
    await user.click(row)
  }

  /** A pane's count reads exactly this. */
  counts = (n: number, count: number) => onScreen().within(byTestId(`explore-pane${n}-count`), (c) => c.assertExactText(String(count)))
  /** A pane's sum shows this. */
  sums = (n: number, sum: string) => onScreen().within(byTestId(`explore-pane${n}-sum`), (s) => s.assertText(sum))
}

async function exploreSuppliersAndOrders(admin: Client) {
  await seedPurchasing(admin)
  const explore = new Explore()
  await explore.open(admin)
  await explore.startFrom('Supplier')
  await explore.addStep(2, 'Purchase Order')
  return explore
}

/** Volunteers and the chores assigned to them. */
async function seedChores(admin: Client) {
  await table(admin, { name: 'Volunteer', id_pattern: 'prompt', title_column: 'title',
    columns: [data('title'), data('phone', 'Phone')] })
  await table(admin, { name: 'Chore', id_pattern: 'prompt', title_column: 'title',
    columns: [data('title'), link('assigned_to', 'Assigned To', 'Volunteer')] })
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
  /** A box's text, once `text` shows in it. */
  async boxText(box: Promise<HTMLElement>, text: string) {
    const el = await box
    await waitFor(() => expect(el).toHaveTextContent(text))
    return (el.textContent ?? '').trim()
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

  // ---- Explore chains tables and narrows them as you click ----

  scenario('Narrow by clicking', async ({ admin }, step) => {
    const user = userEvent.setup()
    let explore!: Explore
    await step('the user starts Explore from Supplier and adds Purchase Order', async () => {
      explore = await exploreSuppliersAndOrders(admin)
    })
    await step('the user clicks one supplier and then adds PO Line', async () => {
      await explore.clickRow(user, 1, 'Acme')
      await explore.addStep(3, 'PO Line')
    })
    await step("Purchase Order narrows to that supplier's orders", async () => {
      await explore.counts(2, 2)
      const rows = explore.rows(2).map((r) => r.textContent ?? '')
      expect(rows.every((r) => r.includes('Acme')), JSON.stringify(rows)).toBe(true)
    })
    await step("PO Line narrows to those orders' lines, with an accurate count and sum at every stage", async () => {
      await explore.counts(1, 2)
      await explore.counts(2, 2)
      await explore.counts(3, 3)
      await explore.sums(3, '350')
    })
  })

  scenario('Open a row without leaving Explore', async ({ admin }, step) => {
    const user = userEvent.setup()
    let explore!: Explore
    await step("the user has Explore narrowed to one supplier's orders", async () => {
      explore = await exploreSuppliersAndOrders(admin)
      await explore.clickRow(user, 1, 'Acme')
      await explore.counts(2, 2)
    })
    await step('the user opens one of those orders', () => explore.clickRow(user, 2, 'Acme order 1'))
    await step('it shows in the drill pane', async () => {
      expect(await screen.findByRole('complementary', { name: /^Acme order 1(?![\w ]*\w)/i })).toBeInTheDocument()
    })
    await step('the supplier stays selected in Explore', () => {
      const chips = screen.getAllByTestId('explore-chip')
      expect(chips).toHaveLength(1)
      expect(chips[0]).toHaveTextContent('Supplier')
      const selected = screen.getByTestId('explore-pane1').querySelectorAll('[data-testid="explore-row"][data-selected]')
      expect([...selected].map((r) => r.textContent).join('|')).toContain('Acme')
    })
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
      expect(await map.boxText(map.collection('Plant'), '3')).toMatch(/\b3\b/)
    })
  })

  scenario('Jump to a related row', async ({ admin }, step) => {
    const map = new RelationMap()
    await step("the user is looking at Enchakkal's map", async () => {
      const org = await seedOrganisation(admin)
      await map.open(admin, SITE, org.site.Enchakkal!)
    })
    await step('the user chooses to centre the map on the region Kerala', async () => {
      fireEvent.click(await map.linkedRow('Region'))
      // The drill pane's "Focus here" re-centres the map.
      const focus = await screen.findAllByRole('button', { name: /^(Centre|Center|Focus)( here| on| the map)?/i })
      fireEvent.click(focus[0]!)
    })
    await step('the map re-centres on Kerala, showing what it in turn points to and back from', async () => {
      await map.centredOn('Kerala')
      expect(await map.boxText(map.collection(SITE), '3')).toMatch(/\b3\b/)
    })
  })

  // ---- Find the starting table by typing; a linked row reads by its title ----

  scenario('Explore opens on the purchases', async ({ admin }, step) => {
    const user = userEvent.setup()
    const explore = new Explore()
    await step('the user is a System Manager', () => {})
    await step('a table of suppliers and a table of purchases, each purchase from a supplier', () => seedPurchases(admin))
    await step(`the user types "purch" in Explore's table search and presses Enter`, async () => {
      await explore.open(admin)
      await explore.searchAndStart(user, 'purch')
    })
    await step('Explore starts from the purchases', async () => expect(await explore.startingTable()).toBe('Purchase'))
  })

  scenario('Each purchase shows its supplier "Acme"', async ({ admin }, step) => {
    const user = userEvent.setup()
    const explore = new Explore()
    await step('the user is a System Manager', () => {})
    await step('a table of suppliers and a table of purchases, each purchase from a supplier', () => seedPurchases(admin))
    await step('the purchases are from the supplier "Acme"', async () => {
      const { updated_at } = await admin.get<{ updated_at: string }>('/api/table/Supplier/sup-1')
      await patchDoc(admin, '/api/table/Supplier/sup-1', { title: 'Acme', updated_at })
    })
    await step(`the user types "purch" in Explore's table search and presses Enter`, async () => {
      await explore.open(admin)
      await explore.searchAndStart(user, 'purch')
    })
    await step('each purchase shows "Acme"', async () => {
      await waitFor(() => expect(within(screen.getByTestId('explore-pane1')).getAllByText('Acme', { exact: true }).length).toBeGreaterThan(0))
      const rows = explore.rows(1).map((r) => r.textContent ?? '')
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) expect(row, `a purchase reads "${row}"`).toContain('Acme')
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
    await step('a table of volunteers and a table of chores, each chore assigned to a volunteer', () => seedChores(admin))
    await step('the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"', () => addChore(admin))
    await step("the user opens Asha's relationship map", () => map.open(admin, 'Volunteer', 'vol-1'))
    await step(`the user sees Asha's chores related by "Assigned To"`, async () => {
      const text = await map.boxText(map.collection('Chore'), 'Assigned To')
      expect(text).toContain('Chore')
      expect(text).toContain('Assigned To')
      expect(text).not.toContain('assigned_to')
    })
  })
})

async function seedPurchases(admin: Client) {
  await table(admin, { name: 'Supplier', id_pattern: 'prompt', title_column: 'title', columns: [data('title')] },
    [{ row_id: 'sup-1', title: 'Bolt Co' }])
  await table(admin, { name: 'Purchase', id_pattern: 'prompt', title_column: 'title',
    columns: [data('title'), { column_name: 'supplier', column_type: 'Reference', reference_table: 'Supplier', in_list_view: true }] },
    [{ row_id: 'po-1', title: 'First order', supplier: 'sup-1' }])
}

async function addChore(admin: Client) {
  await admin.post('/api/table/Volunteer', { row_id: 'vol-1', title: 'Asha', phone: '555-0142' })
  await admin.post('/api/table/Chore', { row_id: 'chore-1', title: 'Paint the fence', assigned_to: 'vol-1' })
}
