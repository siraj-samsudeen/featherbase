// list-view's scenarios, as a person reads them on screen (#1070: off the
// cucumber suite). Each test is one fenced scenario of the effective spec
// (openspec/specs/list-view/spec.md and the issue-910-relational-navigation
// change's delta), step by step, rendered in jsdom against the real
// in-process server.
//
// "The user" and "a colleague" are people who may read the table and are not
// System Managers, unless a scenario makes the user a System Manager. Signing
// in again is a fresh page with nothing kept in the browser: only what the
// server remembers comes back.
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, vi } from 'vitest'
import { tableHref } from 'shared'
import { grantRole } from 'server/test/fixtures'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp, onScreen, inside } from '../pg-test'
import { SITE, listColumns, readerRoles, seedOrganisation } from '../organisation-fixture'

configure({ asyncUtilTimeout: 10_000 })

type Client = Parameters<typeof renderApp>[1]
type View = Awaited<ReturnType<typeof renderApp>>
type CreateUser = (o: { email?: string; roles?: string[] }) => Promise<Client>
const scenario = scenarioFor(test, 'list-view')
const enc = encodeURIComponent

// ---- Section Mapping (#738): ten columns, two rows; values are made up ----

const SECTION_MAPPING = ['Section', 'MCH', 'Floor', 'Zone', 'Rack', 'Owner', 'Category', 'Remarks', 'Updated By', 'Notes']
const COLUMN_NAMES: Record<string, string> = {
  Section: 'section', MCH: 'mch', Floor: 'floor', Zone: 'zone', Rack: 'rack', Owner: 'owner',
  Category: 'category', Remarks: 'remarks', 'Updated By': 'updated_by_1', Notes: 'notes',
}
const SM_ROWS = [
  ['Sarees', 'MCH-101', 'Ground', 'A', 'R1', 'Team North', 'Apparel', 'Check stock weekly', 'Admin', 'Seasonal'],
  ['Kids Wear', 'MCH-202', 'First', 'B', 'R2', 'Team South', 'Apparel', 'Near the lift', 'Admin', 'Year round'],
]
const SM_IDS = ['SM-1', 'SM-2']
/** The list columns a new Section Mapping starts with: its first seven. */
const DEFAULT_LIST = SECTION_MAPPING.slice(0, 7)

type Given = { table: string; listColumns: string[]; tableColumns: string[]; rowIds: string[]; user: Client; colleague: Client }

/** Creates the table, lets a reader role read it, and makes "the user" and "a colleague" its readers. */
async function givenTable(admin: Client, createUser: CreateUser, def: { name: string; columns: { label: string; in_list_view: boolean; [k: string]: unknown }[] },
  rows: Record<string, unknown>[]): Promise<Given> {
  await admin.post('/api/table_def', { id_pattern: 'prompt', ...def })
  for (const row of rows) await admin.post(`/api/table/${enc(def.name)}`, row)
  const role = `${def.name} Reader`
  await grantRole(admin, { role, table: def.name, can_read: true })
  return {
    table: def.name,
    tableColumns: def.columns.map((c) => c.label),
    listColumns: def.columns.filter((c) => c.in_list_view).map((c) => c.label),
    rowIds: rows.map((r) => String(r.row_id)),
    user: await createUser({ email: 'the.user@example.com', roles: [role] }),
    colleague: await createUser({ email: 'a.colleague@example.com', roles: [role] }),
  }
}

function sectionMapping(admin: Client, createUser: CreateUser, list: string[], name = 'Section Mapping') {
  return givenTable(admin, createUser, {
    name,
    columns: SECTION_MAPPING.map((label) => ({ column_name: COLUMN_NAMES[label]!, label, column_type: 'Data', in_list_view: list.includes(label) })),
  }, SM_ROWS.map((r, n) => ({ row_id: SM_IDS[n], ...Object.fromEntries(SECTION_MAPPING.map((label, i) => [COLUMN_NAMES[label], r[i]])) })))
}

function shelfCheck(admin: Client, createUser: CreateUser) {
  return givenTable(admin, createUser, {
    name: 'Shelf Check',
    columns: ['Shelf', 'Aisle', 'Checked On', 'Note'].map((label) => ({
      column_name: label.toLowerCase().replace(/ /g, '_'), label, column_type: 'Data', in_list_view: false,
    })),
  }, [
    { row_id: 'SC-1', shelf: 'S1', aisle: 'A', checked_on: 'Monday', note: 'Tidy' },
    { row_id: 'SC-2', shelf: 'S2', aisle: 'B', checked_on: 'Tuesday', note: 'Restock' },
  ])
}

// ---- the list on screen ----

const listRows = () => [...screen.getByTestId('list-rows').querySelectorAll('tr')]
const rowTexts = () => listRows().map((r) => r.textContent ?? '')
const headerCells = () => [...screen.getByTestId('list-view').querySelectorAll('thead [data-testid^="col-"]')]
  .map((el) => ({ id: el.getAttribute('data-testid')!, text: el.textContent ?? '' }))
/** Every column header the list shows, Row ID included, in order. */
const allColumnLabels = () => headerCells().map((c) => c.text.replace(/[↑↓]/g, '').trim())
/** The labels of the columns the list shows after Row ID. */
const columnLabels = () => headerCells().filter((c) => c.id !== 'col-row_id').map((c) => c.text.replace(/[↑↓]/g, '').trim())
const columnValues = (name: string) => listRows().map((r) => (r.querySelector(`[data-testid="cell-${name}"]`)?.textContent ?? '').trim())
/** The names leading each row: its first linked cell. */
const leadingLinks = () => listRows().flatMap((r) => [...r.querySelectorAll('td a')].map((a) => (a.textContent ?? '').trim()))

// A list ignores a change to its arrangement made before the person's saved
// arrangement has arrived (list-settings.test.tsx), so a step waits for that
// read before changing anything, as a person would wait for the list.
const settingsReads = new Map<string, number>()
beforeEach(() => {
  settingsReads.clear()
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const res = await real(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : (input as Request).url
    const at = url.indexOf('/api/user_settings/')
    if (at >= 0 && (!init?.method || init.method === 'GET')) {
      const key = decodeURIComponent(url.slice(at + '/api/user_settings/'.length).split('?')[0]!)
      settingsReads.set(key, (settingsReads.get(key) ?? 0) + 1)
    }
    return res
  })
})
afterEach(() => vi.restoreAllMocks())

/** The list of `table` as `as` sees it now, opened afresh, once its saved arrangement has arrived. */
async function openList(as: Client, table: string, search = '') {
  cleanup()
  const reads = settingsReads.get(table) ?? 0
  const view = await renderApp(`${tableHref(table)}${search}`, as)
  await screen.findByTestId('list-view')
  await waitFor(() => expect(headerCells().length).toBeGreaterThan(0))
  await waitFor(() => expect(settingsReads.get(table) ?? 0).toBeGreaterThan(reads))
  await new Promise((resolve) => setTimeout(resolve, 0))
  return view
}

/** Signs in again: a fresh page, nothing kept in the browser, only what the server remembers. */
function signInAfresh() {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
}

const settingsOf = async (as: Client, table: string) =>
  (await as.get<{ settings: { hiddenCols?: string[]; shownCols?: string[]; sort?: { field: string; dir: string } | null; compact?: boolean } | null }>(
    `/api/user_settings/${enc(table)}`)).settings ?? {}

async function openMenu() {
  if (!screen.queryByTestId('list-columns-popup')) fireEvent.click(screen.getByTestId('list-columns'))
  return screen.findByTestId('list-columns-popup')
}

/**
 * Ticks or unticks a column in "Show columns" and waits until the person's
 * view is saved with it. A click before the saved view has arrived is
 * ignored (list-settings.test.tsx), so it is clicked again until it holds.
 */
async function switchColumn(as: Client, table: string, label: string, on: boolean) {
  const name = COLUMN_NAMES[label] ?? label.toLowerCase().replace(/ /g, '_')
  const box = within(await openMenu()).getByRole('checkbox', { name: label }) as HTMLInputElement
  if (box.checked !== on) fireEvent.click(box)
  await waitFor(async () => {
    const saved = await settingsOf(as, table)
    if (on) expect(columnLabels()).toContain(label)
    else expect(columnLabels()).not.toContain(label)
    expect(on ? saved.shownCols ?? [] : saved.hiddenCols ?? []).toContain(name)
  })
}

/** Unticks every column the menu lets the person untick, each saved. */
async function switchOffEverything(as: Client, table: string) {
  const menu = await openMenu()
  const labels = within(menu).getAllByRole('checkbox')
    .filter((box) => (box as HTMLInputElement).checked && !(box as HTMLInputElement).disabled)
    .map((box) => (box.closest('label')?.textContent ?? '').trim())
  for (const [n, label] of labels.entries()) {
    fireEvent.click(within(await openMenu()).getByRole('checkbox', { name: label }))
    await waitFor(async () => {
      expect(columnLabels()).not.toContain(label)
      expect((await settingsOf(as, table)).hiddenCols ?? []).toHaveLength(n + 1)
    })
  }
}

/**
 * "Make this the default for everyone", waiting until the Table's list
 * columns are saved and the System Manager's own view, now the default, is
 * saved empty: that last save is the page's, and must land before anyone
 * else signs in on it.
 */
async function makeDefaultForEveryone(admin: Client, table: string, want: Record<string, boolean>) {
  fireEvent.click(within(await openMenu()).getByRole('button', { name: 'Make this the default for everyone' }))
  await waitFor(async () => {
    const meta = await admin.get<{ columns: { label?: string; in_list_view?: boolean }[] }>(`/api/table/${enc(table)}:meta`)
    for (const [label, listed] of Object.entries(want))
      expect(Boolean(meta.columns.find((c) => c.label === label)?.in_list_view), label).toBe(listed)
    expect(await settingsOf(admin, table)).toMatchObject({ shownCols: [], hiddenCols: [] })
  })
}

// ---- Customers and their orders (#792/#793): customers titled by their name ----

const CUSTOMERS = 'Pick Customer'
const ORDERS = 'Pick Order'
const ORDERS_OF: Record<string, string[]> = { 'Globex Ltd': ['Widgets', 'Sprockets'], Initech: ['Gears'] }
const CUSTOMER_IDS: Record<string, string> = { 'Globex Ltd': 'cust-1', Initech: 'cust-2' }

async function ordersFromCustomers(admin: Client) {
  await admin.post('/api/table_def', {
    name: CUSTOMERS, id_pattern: 'prompt', title_column: 'customer_name',
    columns: [{ column_name: 'customer_name', label: 'Customer Name', column_type: 'Data', in_list_view: true }],
  })
  for (const [row_id, customer_name] of [['cust-1', 'Globex Ltd'], ['cust-2', 'Initech']])
    await admin.post(`/api/table/${enc(CUSTOMERS)}`, { row_id, customer_name })
  await admin.post('/api/table_def', {
    name: ORDERS, id_pattern: 'PKO-.###',
    columns: [
      { column_name: 'item', label: 'Item', column_type: 'Data', in_list_view: true },
      { column_name: 'customer', label: 'Customer', column_type: 'Reference', reference_table: CUSTOMERS, in_list_view: true },
    ],
  })
  for (const [item, customer] of [['Widgets', 'cust-1'], ['Sprockets', 'cust-1'], ['Gears', 'cust-2']])
    await admin.post(`/api/table/${enc(ORDERS)}`, { item, customer })
}

const customerFilter = (customer: string) => `?filters=${enc(JSON.stringify([['customer', '=', CUSTOMER_IDS[customer] ?? customer]]))}`

async function ordersShown(items: string[]) {
  await waitFor(() => expect(columnValues('item').sort()).toEqual([...items].sort()))
}

/** The orders list's line whose Item is `item`. */
const orderRow = (item: string) => listRows().find((r) => r.querySelector('[data-testid="cell-item"]')?.textContent?.includes(item))!

async function typeIntoQuickFilter(admin: Client, text: string) {
  await openList(admin, ORDERS)
  await ordersShown(['Widgets', 'Sprockets', 'Gears'])
  const filter = screen.getByTestId('std-filter-customer')
  fireEvent.focus(filter)
  fireEvent.change(filter, { target: { value: text } })
  const options = await screen.findByTestId('link-options-customer')
  // The search runs a moment after typing; wait for its answer.
  await waitFor(() => expect(within(options).queryAllByTestId('link-option').length).toBeGreaterThan(0))
  return options
}
const offered = (options: HTMLElement) => within(options).queryAllByTestId('link-option').map((o) => (o.textContent ?? '').trim())

async function ledByNames(first: string, second: string) {
  await waitFor(() => {
    expect(headerCells()[0]?.id).toBeTruthy()
    expect(headerCells()[0]!.id).not.toBe('col-row_id')
    expect(leadingLinks()).toEqual(expect.arrayContaining([first, second]))
  })
  for (const id of ['cust-1', 'cust-2']) expect(rowTexts().some((t) => t.includes(id)), `a row still shows the row ID ${id}`).toBe(false)
}

async function namelessCustomer(admin: Client, rowId: string, item: string) {
  await admin.post(`/api/table/${enc(CUSTOMERS)}`, { row_id: rowId, customer_name: '' })
  await admin.post(`/api/table/${enc(ORDERS)}`, { item, customer: rowId })
}

// ---- the sites (#910): compact and tree layouts ----

/** A list layout: "Table" and "Compact" in its group, and the list header's "Tree of all" (#910 checklist 19). */
const layout = (name: string) => name === 'Tree'
  ? screen.getByRole('button', { name: /^Tree( of all)?$/ })
  : within(screen.getByRole('group', { name: 'List layout' })).getByRole('button', { name })
const columnHeaders = () => within(screen.getByRole('main')).getAllByRole('columnheader').map((h) => (h.textContent ?? '').replace(/[↑↓]/g, '').trim())

describe('list-view', () => {
  scenario('Return after hiding a column', async ({ admin, createUser }, step) => {
    let given!: Given
    await step('the user has hidden a column and sorted the list of a table', async () => {
      given = await sectionMapping(admin, createUser as CreateUser, DEFAULT_LIST)
      await openList(given.user, given.table)
      await switchColumn(given.user, given.table, 'Floor', false)
      // Clicking a header sorts ascending first, then descending.
      await waitFor(async () => {
        const header = screen.getByTestId('col-section')
        if (!header.textContent?.includes('↓')) fireEvent.click(header)
        expect((await settingsOf(given.user, given.table)).sort).toEqual({ field: 'section', dir: 'desc' })
      })
    })
    await step("the user later reopens the same table's list", async () => {
      cleanup()
      await renderApp('/featherbase/admin', given.user)
      await openList(given.user, given.table)
    })
    await step('the column is still hidden', () => waitFor(() => {
      expect(columnLabels()).toContain('Section')
      expect(columnLabels()).not.toContain('Floor')
    }))
    await step('the list is still sorted the way they left it', async () => {
      await inside(onScreen(), 'col-section', (el) => el.assertText('↓'))
      const values = await waitFor(() => {
        const v = columnValues('section')
        expect(v).toHaveLength(2)
        return v
      })
      expect(new Set(values).size).toBeGreaterThan(1)
      expect(values).toEqual([...values].sort((a, b) => b.localeCompare(a)))
    })
  })

  scenario('Remarks is still there next time', async ({ admin, createUser }, step) => {
    let given!: Given
    await step('the user has switched on Remarks in the list of "Section Mapping"', async () => {
      given = await sectionMapping(admin, createUser as CreateUser, DEFAULT_LIST)
      await openList(given.user, given.table)
      await switchColumn(given.user, given.table, 'Remarks', true)
    })
    await step('the user signs out, signs back in and reopens that list', async () => {
      signInAfresh()
      await openList(given.user, given.table)
    })
    await step('Remarks still shows', () => waitFor(() => expect(columnLabels()).toContain('Remarks')))
  })

  scenario('The customers list leads with their names', async ({ admin }, step) => {
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step('the user opens the customers list', () => openList(admin, CUSTOMERS))
    await step('the user sees the list led by "Globex Ltd" and "Initech", without their row IDs', () => ledByNames('Globex Ltd', 'Initech'))
  })

  scenario('Section Mapping shows its seven list columns', async ({ admin, createUser }, step) => {
    let given!: Given
    await step('the table "Section Mapping" whose list columns are Section, MCH, Floor, Zone, Rack, Owner and Category', async () => {
      given = await sectionMapping(admin, createUser as CreateUser, ['Section', 'MCH', 'Floor', 'Zone', 'Rack', 'Owner', 'Category'])
    })
    await step('the user opens its list', () => openList(given.user, given.table))
    await step('the user sees the row ID and those seven columns', async () => {
      expect(given.listColumns).toHaveLength(7)
      await waitFor(() => expect(allColumnLabels()).toEqual(['Row ID', ...given.listColumns]))
    })
    await step("Remarks shows only on a row's form", async () => {
      expect(columnLabels()).not.toContain('Remarks')
      fireEvent.click(await waitFor(() => {
        const link = listRows()[0]?.querySelector('a')
        if (!link) throw new Error('the first row has no link yet')
        return link
      }))
      const form = await screen.findByTestId('form-view')
      expect(await within(form).findByLabelText('Remarks', { exact: true })).toBeInTheDocument()
    })
  })

  scenario('A table with no list columns shows its first two', async ({ admin, createUser }, step) => {
    let given!: Given
    await step('a table with no list columns', async () => {
      given = await shelfCheck(admin, createUser as CreateUser)
    })
    await step('the user opens its list', () => openList(given.user, given.table))
    await step("the user sees the row ID and the table's first two columns", () =>
      waitFor(() => expect(allColumnLabels()).toEqual(['Row ID', ...given.tableColumns.slice(0, 2)])))
  })

  scenario('Remarks shows only for me', async ({ admin, createUser }, step) => {
    let given!: Given
    await step('the table "Section Mapping" with Remarks not in its list', async () => {
      given = await sectionMapping(admin, createUser as CreateUser, DEFAULT_LIST.filter((c) => c !== 'Remarks'))
      expect(given.listColumns).not.toContain('Remarks')
    })
    await step('the user switches on Remarks', async () => {
      await openList(given.user, given.table)
      await switchColumn(given.user, given.table, 'Remarks', true)
    })
    await step("the user's list shows Remarks", () => expect(columnLabels()).toContain('Remarks'))
    await step('a colleague\'s list of "Section Mapping" does not show Remarks', async () => {
      await openList(given.colleague, 'Section Mapping')
      await waitFor(() => expect(columnLabels()).toContain('Section'))
      expect(columnLabels()).not.toContain('Remarks')
    })
  })

  scenario('Every column off leaves the row ID', async ({ admin, createUser }, step) => {
    let given!: Given
    await step('the list of "Section Mapping"', async () => {
      given = await sectionMapping(admin, createUser as CreateUser, DEFAULT_LIST, 'Section Mapping')
      await openList(given.user, given.table)
    })
    await step('the user switches off every column', () => switchOffEverything(given.user, given.table))
    await step("the user's list still shows each row's ID", () =>
      waitFor(() => { for (const id of given.rowIds) expect(rowTexts().some((t) => t.includes(id)), `a row shows ${id}`).toBe(true) }))
  })

  scenario("Every column off leaves each customer's name", async ({ admin }, step) => {
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step('the user switches off every column of the customers list', async () => {
      await openList(admin, CUSTOMERS)
      await switchOffEverything(admin, CUSTOMERS)
    })
    await step('the user sees the list led by "Globex Ltd" and "Initech", without their row IDs', () => ledByNames('Globex Ltd', 'Initech'))
  })

  scenario('My view becomes the default', async ({ admin, createUser }, step) => {
    let given!: Given
    await step('a System Manager has switched on Remarks in the list of "Section Mapping"', async () => {
      given = await sectionMapping(admin, createUser as CreateUser, DEFAULT_LIST)
      await openList(admin, given.table)
      await switchColumn(admin, given.table, 'Remarks', true)
    })
    await step('a colleague has never changed their own view of it', async () =>
      expect(await settingsOf(given.colleague, given.table)).toEqual({}))
    await step('the System Manager makes their view the default for everyone', () =>
      makeDefaultForEveryone(admin, given.table, { Remarks: true }))
    await step("the colleague's list shows Remarks", async () => {
      await openList(given.colleague, given.table)
      await waitFor(() => expect(columnLabels()).toContain('Remarks'))
    })
  })

  scenario("A colleague's own choices hold", async ({ admin, createUser }, step) => {
    let given!: Given
    await step('a colleague has switched off Floor and switched on Notes in the list of "Section Mapping"', async () => {
      given = await sectionMapping(admin, createUser as CreateUser, DEFAULT_LIST)
      await openList(given.colleague, given.table)
      await switchColumn(given.colleague, given.table, 'Floor', false)
      await switchColumn(given.colleague, given.table, 'Notes', true)
    })
    await step('a System Manager makes a default that includes Floor and leaves out Notes', async () => {
      await openList(admin, given.table)
      await waitFor(() => expect(columnLabels()).toContain('Floor'))
      expect(columnLabels()).not.toContain('Notes')
      await makeDefaultForEveryone(admin, given.table, { Floor: true, Notes: false })
    })
    await step("the colleague's list still shows Notes", async () => {
      await openList(given.colleague, given.table)
      await waitFor(() => expect(columnLabels()).toContain('Notes'))
    })
    await step("the colleague's list still does not show Floor", () => expect(columnLabels()).not.toContain('Floor'))
  })

  scenario("Only Globex Ltd's orders show", async ({ admin }, step) => {
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step(`the user types "Glo" into the orders list's quick customer filter and picks "Globex Ltd"`, async () => {
      const options = await typeIntoQuickFilter(admin, 'Glo')
      fireEvent.mouseDown(within(options).getAllByTestId('link-option').find((o) => o.textContent?.includes('Globex Ltd'))!)
    })
    await step('the user sees only the orders from "Globex Ltd"', () => ordersShown(ORDERS_OF['Globex Ltd']!))
  })

  scenario('The customer filter offers no new customer', async ({ admin }, step) => {
    let options!: HTMLElement
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step(`the user types "Glo" into the orders list's quick customer filter`, async () => {
      options = await typeIntoQuickFilter(admin, 'Glo')
    })
    await step('the user is offered "Globex Ltd" and no way to create a customer', () => {
      expect(offered(options)).toEqual(['Globex Ltd'])
      expect(within(options).queryByTestId('link-create-new')).not.toBeInTheDocument()
    })
  })

  scenario('The customer filter reads "Globex Ltd"', async ({ admin }, step) => {
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step('the user opens a link to the orders list filtered to the customer "Globex Ltd"', () =>
      openList(admin, ORDERS, customerFilter('Globex Ltd')))
    await step('the user sees the quick customer filter reading "Globex Ltd"', () =>
      waitFor(() => expect(screen.getByTestId('std-filter-customer')).toHaveValue('Globex Ltd')))
  })

  scenario('The filter in use names Globex Ltd', async ({ admin }, step) => {
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step('the user opens a link to the orders list filtered to the customer "Globex Ltd"', () =>
      openList(admin, ORDERS, customerFilter('Globex Ltd')))
    await step('the user sees the filter in use reading "Customer = Globex Ltd"', () =>
      waitFor(() => expect((screen.getAllByTestId('filter-chip')[0]!.textContent ?? '').replace('×', '').trim()).toBe('Customer = Globex Ltd')))
  })

  scenario('The recent filter names Globex Ltd', async ({ admin }, step) => {
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step('the orders list filtered to the customer "Globex Ltd"', async () => {
      await openList(admin, ORDERS, customerFilter('Globex Ltd'))
      await ordersShown(ORDERS_OF['Globex Ltd']!)
    })
    await step('the user comes back to the whole orders list', async () => {
      await openList(admin, ORDERS)
      await ordersShown(['Widgets', 'Sprockets', 'Gears'])
    })
    await step('the user sees a recent filter reading "Customer = Globex Ltd"', () =>
      waitFor(() => expect(screen.getAllByTestId('recent-strip-view').map((v) => (v.textContent ?? '').trim())).toContain('Customer = Globex Ltd')))
  })

  scenario("Both customers' orders show again", async ({ admin }, step) => {
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step('the orders list filtered to the customer "Globex Ltd"', async () => {
      await openList(admin, ORDERS, customerFilter('Globex Ltd'))
      await ordersShown(ORDERS_OF['Globex Ltd']!)
    })
    await step('the user clears the quick customer filter', async () =>
      fireEvent.click(await screen.findByRole('button', { name: /clear the customer filter/i })))
    await step('the user sees the orders from both "Globex Ltd" and "Initech"', () =>
      ordersShown([...ORDERS_OF['Globex Ltd']!, ...ORDERS_OF.Initech!]))
  })

  scenario('The filter in use names the Item column', async ({ admin }, step) => {
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step('the user opens a link to the orders list filtered to the item "Widgets"', () =>
      openList(admin, ORDERS, `?filters=${enc(JSON.stringify([['item', '=', 'Widgets']]))}`))
    await step('the user sees the filter in use reading "Item = Widgets"', () =>
      waitFor(() => expect((screen.getAllByTestId('filter-chip')[0]!.textContent ?? '').replace('×', '').trim()).toBe('Item = Widgets')))
  })

  scenario('The Widgets order\'s customer reads "Globex Ltd"', async ({ admin }, step) => {
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step('the user opens the orders list', () => openList(admin, ORDERS))
    await step('the user sees the customer of the order "Widgets" as "Globex Ltd · cust-1"', () =>
      waitFor(() => expect((orderRow('Widgets').querySelector('[data-testid="cell-customer"]')?.textContent ?? '').trim()).toBe('Globex Ltd · cust-1')))
  })

  scenario('Globex Ltd opens from an order', async ({ admin }, step) => {
    let view!: View
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step('the user opens the orders list and clicks the customer of the order "Widgets"', async () => {
      view = await openList(admin, ORDERS)
      const link = await waitFor(() => {
        const a = orderRow('Widgets')?.querySelector<HTMLElement>('[data-testid="cell-customer"] a')
        if (!a) throw new Error("the Widgets order's customer is no link yet")
        return a
      })
      fireEvent.click(link)
    })
    await step('the user sees the customer "Globex Ltd" in the drill pane beside the orders list', async () => {
      await screen.findByRole('complementary', { name: /^Globex Ltd( · .+)?$/ })
      expect((view.router.state as { location: { pathname: string } }).location.pathname).toBe(tableHref(ORDERS))
    })
  })

  scenario('A nameless customer is listed by its id', async ({ admin }, step) => {
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step('a customer "cust-3" with no name, with the order "Bolts"', () => namelessCustomer(admin, 'cust-3', 'Bolts'))
    await step('the user opens the customers list', () => openList(admin, CUSTOMERS))
    await step('the user sees the customer "cust-3" listed by its id', async () => {
      expect(headerCells()[0]?.id).not.toBe('col-row_id')
      await waitFor(() => expect(leadingLinks().some((t) => t.includes('cust-3'))).toBe(true))
      expect(leadingLinks()).not.toContain('')
    })
  })

  scenario("A nameless customer's order reads its id", async ({ admin }, step) => {
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step('a customer "cust-3" with no name, with the order "Bolts"', () => namelessCustomer(admin, 'cust-3', 'Bolts'))
    await step('the user opens the orders list', () => openList(admin, ORDERS))
    await step('the user sees the customer of the order "Bolts" read by its id "cust-3"', () =>
      waitFor(() => expect(orderRow('Bolts').querySelector('[data-testid="cell-customer"]')?.textContent ?? '').toContain('cust-3')))
  })

  scenario('The sites list stays compact', async ({ admin, createUser }, step) => {
    let user!: Client
    await step('the user switched the list of sites to its compact layout', async () => {
      await seedOrganisation(admin)
      user = await (createUser as CreateUser)({ email: 'compact@example.com', roles: await readerRoles(admin) })
      await openList(user, SITE)
      fireEvent.click(layout('Compact'))
      await waitFor(async () => expect((await settingsOf(user, SITE)).compact).toBe(true))
    })
    await step('the user signs in again and opens the list of sites', async () => {
      signInAfresh()
      await openList(user, SITE)
    })
    await step('Enchakkal shows by its name with a few key values', async () => {
      await waitFor(() => expect(layout('Compact')).toHaveAttribute('aria-pressed', 'true'))
      await waitFor(() => expect(within(screen.getByRole('main')).getAllByText('Enchakkal', { exact: true })[0]).toBeVisible())
      await waitFor(() => expect(columnHeaders().length).toBeLessThan(listColumns(SITE).length))
    })
    await step('the list of plants still shows all its columns', async () => {
      await openList(user, 'Plant')
      expect(layout('Compact')).not.toHaveAttribute('aria-pressed', 'true')
      await waitFor(() => { for (const label of listColumns('Plant')) expect(columnHeaders()).toContain(label) })
    })
  })

  scenario('Every site, folded', async ({ admin }, step) => {
    const named = (name: string) => new RegExp(`^\\W*${name}( · .+)?$`)
    await step('there are four sites, among them Enchakkal', () => seedOrganisation(admin))
    await step('the user opens the list of sites as a tree', async () => {
      await openList(admin, SITE)
      fireEvent.click(layout('Tree'))
      await screen.findByRole('tree')
    })
    await step('the four sites show folded, one line each', async () => {
      const top = () => within(screen.getByRole('tree')).getAllByRole('treeitem').filter((i) => i.getAttribute('aria-level') === '1')
      await waitFor(() => expect(top()).toHaveLength(4))
      for (const name of ['Enchakkal', 'Attakulangara', 'Pazhavangadi', 'Tenkasi']) {
        const line = within(screen.getByRole('tree')).getAllByRole('treeitem', { name: named(name) }).at(-1)!
        expect(line, name).toHaveAttribute('aria-expanded', 'false')
      }
    })
    await step('unfolding Enchakkal shows its region and its group of plants', async () => {
      const enchakkal = within(screen.getByRole('tree')).getAllByRole('treeitem', { name: named('Enchakkal') }).at(-1)!
      fireEvent.keyDown(enchakkal, { key: 'ArrowRight' })
      await waitFor(() => expect(enchakkal).toHaveAttribute('aria-expanded', 'true'))
      await waitFor(() => expect(within(enchakkal).getAllByText(/\bKerala\b/)[0]).toBeVisible())
      const plants = await within(enchakkal).findByRole('treeitem', { name: /^Plants?\s*\d+$/ })
      expect(Number((plants.textContent ?? '').replace(/\D+/g, ''))).toBe(3)
    })
  })
})
