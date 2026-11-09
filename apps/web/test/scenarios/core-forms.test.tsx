// core-forms' scenarios, as a person reads them on screen (#1070: off the
// cucumber suite). Each test is one fenced scenario of
// openspec/specs/core-forms/spec.md, step by step, rendered in jsdom against
// the real in-process server.
//
// jsdom lays nothing out: "below its other fields" and "below the one before"
// are read from document order and from the form's column classes; the pixels
// are a real browser's to show.
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import postgres from 'postgres'
import { afterAll, beforeAll, describe } from 'vitest'
import { rowHref, tableHref } from 'shared'
import { sql } from 'server/src/db'
import { invalidateMeta } from 'server/src/meta'
import { invalidateSources } from 'server/src/sources/registry'
import { EXTERNAL_DATABASE_URL } from 'server/test/external-database'
import { grantRole } from 'server/test/fixtures'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp, onScreen, inside, type Session } from '../pg-test'

configure({ asyncUtilTimeout: 10_000 })

type Client = Parameters<typeof renderApp>[1]
type View = Awaited<ReturnType<typeof renderApp>>
type CreateUser = (o: { email?: string; roles?: string[] }) => Promise<Client>
const scenario = scenarioFor(test, 'core-forms')
const enc = encodeURIComponent
const location = (view: View) => (view.router.state as { location: { pathname: string } }).location

/** Signs in again: a fresh page, nothing kept in the browser, only what the server remembers. */
function signInAfresh() {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
}

// ---- Customers and their orders (#793): customers titled by their name ----

const CUSTOMERS = 'Pick Customer'
const ORDERS = 'Pick Order'

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

const customerBox = () => within(screen.getByTestId('form-view')).getByLabelText('Customer', { exact: true }) as HTMLInputElement

// ---- Parcels on racks, in a connected database (#795); every value made up ----

const SCHEMA = 'scn_parcel'
const URL_ENV = 'SCENARIO_PARCEL_URL'
process.env[URL_ENV] = EXTERNAL_DATABASE_URL
let outside: ReturnType<typeof postgres>

beforeAll(async () => {
  outside = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
  await outside.unsafe(`drop schema if exists ${SCHEMA} cascade`)
})
afterAll(async () => {
  invalidateSources()
  await outside.unsafe(`drop schema if exists ${SCHEMA} cascade`)
  await outside.end({ timeout: 2 })
})

/** The outside database: racks, and parcels whose columns run in an order no other arrangement matches. */
async function parcelsOnRacks(admin: Client, senderLimit: number) {
  await outside.unsafe(`drop schema if exists ${SCHEMA} cascade`)
  // Source order: who created it first, the label in the middle, the rack and
  // who updated it last, so no arrangement but the source's own matches it.
  await outside.unsafe(`create schema ${SCHEMA};
    create table ${SCHEMA}.rack (id bigint primary key, label text);
    create table ${SCHEMA}.parcel (
      id bigint primary key,
      created_on timestamptz not null default now(),
      label varchar(300),
      weight numeric(6,2),
      note text,
      fragile boolean,
      instructions text,
      sent_on date,
      photo text,
      sender varchar(${senderLimit}) not null,
      rack_id bigint references ${SCHEMA}.rack(id),
      updated_by varchar(60))`)
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'parcels', engine: 'postgres', url_env: URL_ENV, default_schema: SCHEMA, access: 'read_only' })
  await admin.post('/api/table/Data%20Source/parcels:reflect', {
    schema: SCHEMA, tables: ['rack', 'parcel'], names: { rack: 'Rack', parcel: 'Parcel' },
  })
}

async function parcelOnRack(label: string, rack: string) {
  await outside.unsafe(`insert into ${SCHEMA}.rack values (3, $1)`, [rack])
  await outside.unsafe(
    `insert into ${SCHEMA}.parcel (id, label, weight, fragile, instructions, sent_on, photo, sender, rack_id, updated_by)
     values (7, $1, 2.5, true, $2, '2026-10-30', 'parcels/blue-box.png', 'Front desk', 3, 'kiosk')`,
    [label, 'Keep upright.\nOpen from the top.'])
}

/** A person who may read parcels and racks, and nothing more. */
async function parcelReader(admin: Client, createUser: CreateUser, email: string) {
  await grantRole(admin, { role: 'Parcel Reader', table: ['Parcel', 'Rack'], can_read: true })
  return createUser({ email, roles: ['Parcel Reader'] })
}

/** The usual three Givens: the database, the Blue box on the Top rack, and a reader of both. */
async function blueBoxReader(admin: Client, createUser: CreateUser, step: (text: string, run?: () => unknown) => Promise<void>) {
  let user!: Client
  await step('a connected database of parcels on racks, where every parcel has a sender of up to 500 characters', () => parcelsOnRacks(admin, 500))
  await step('a parcel labelled "Blue box" on the rack "Top"', () => parcelOnRack('Blue box', 'Top'))
  await step('the user may read parcels and racks', async () => {
    user = await parcelReader(admin, createUser, 'parcel.reader@example.com')
  })
  return user
}

// The form of the page now: saving a new row moves to its own page, a new form.
const form = () => screen.getByTestId('form-view')
/** The Session DSL inside the open form. */
const onForm = (fn: Parameters<Session['within']>[1]) => inside(onScreen(), 'form-view', fn)
/** The labels of the fields shown, in order; folded fields and the foot line are not fields. */
const fieldLabels = () => [...form().querySelectorAll<HTMLElement>('[data-form-field]')].map((e) => e.dataset.label)
const field = (label: string) => form().querySelector<HTMLElement>(`[data-form-field][data-label="${label}"]`)
const valueOf = (label: string) => field(label)!.querySelector<HTMLElement>('[data-value]')!
const groupOf = (label: string) => field(label)!.closest<HTMLElement>('[data-testid="field-group"]')?.dataset.group ?? null
const typeMarkOf = (label: string) => field(label)?.querySelector('[data-type-mark]')?.getAttribute('data-type-mark') ?? null

async function openParcel(as: Client) {
  cleanup()
  await renderApp(rowHref('Parcel', '7'), as)
  await waitFor(() => expect(fieldLabels().length).toBeGreaterThan(0))
}

async function arrangeBy(mode: string) {
  fireEvent.click(within(form()).getByTestId(`arrange-${mode}`))
  await waitFor(() => expect(form().querySelector(`[data-arrangement="${mode}"]`)).not.toBeNull())
}

/** Every field one under the other: no group or section of the form lays its fields in two columns. */
function oneColumn() {
  expect(fieldLabels().length).toBeGreaterThan(1)
  const grids = [...form().querySelectorAll('[data-testid="field-group"] .grid, [data-testid^="form-section-"]')]
  expect(grids.length).toBeGreaterThan(0)
  for (const grid of grids) expect(grid.className).not.toMatch(/grid-cols-2/)
}

const IMPORTANCE = ['Label', 'Rack', 'Sender', 'Weight', 'Fragile', 'Instructions', 'Sent On', 'Photo']

// ---- A parcel counter Table its builder laid out in two sections ----

const COUNTER = 'Parcel Counter'

// ---- Metadata Overrides: adjustments to a Table ----

const SHELF = 'Editor Shelf'
const OTHER = `${SHELF} Other`
const overrideRows = (admin: Client, filters: unknown[]) =>
  admin.get<{ data: { row_id: string; table_name: string; column_name: string | null; property: string; value: string }[] }>(
    `/api/table/Metadata%20Override?filters=${enc(JSON.stringify(filters))}&fields=${enc(JSON.stringify(['row_id', 'table_name', 'column_name', 'property', 'value']))}`)
const columnHidden = async (admin: Client, table: string, column: string) =>
  (await admin.get<{ columns: { column_name: string; hidden?: boolean }[] }>(`/api/table/${enc(table)}:meta`))
    .columns.find((c) => c.column_name === column)?.hidden

async function shelf(admin: Client) {
  await admin.post('/api/table_def', { name: SHELF, columns: [{ column_name: 'floor', column_type: 'Data', in_list_view: true }] })
  await admin.post('/api/save_row', { table: 'Custom Field', row: { row_id: `${SHELF}-note`, dt: SHELF, column_name: 'note', column_type: 'Data', label: 'Note' } })
}

async function newAdjustment(admin: Client) {
  cleanup()
  const view = await renderApp(`${tableHref('Metadata Override')}/new?prefill=${enc(JSON.stringify({ table_name: SHELF }))}`, admin)
  await waitFor(() => expect(within(form()).getByLabelText('Column', { exact: true })).toBeEnabled())
  return view
}

async function chooseHidden(user: ReturnType<typeof userEvent.setup>, column: string) {
  const columnSelect = within(form()).getByLabelText('Column', { exact: true })
  await waitFor(() => expect([...columnSelect.querySelectorAll('option')].map((o) => o.textContent)).toEqual(
    expect.arrayContaining(['', 'Whole Table', 'floor', 'note'])))
  await onForm((f) => f.selectOption('Column', column).selectOption('Setting', 'Hidden (hidden)').check('Value'))
}

async function saveHidden(user: ReturnType<typeof userEvent.setup>, view: View, column: string) {
  await chooseHidden(user, column)
  expect(form().querySelector('[data-field="row_id"]')).toBeNull()
  await onForm((f) => f.clickButton('Save'))
  await screen.findByRole('link', { name: `Open Table: ${SHELF}` })
  return decodeURIComponent(location(view).pathname.split('/').pop()!)
}

/** Points the adjustment at the other Table, "Editor Shelf Other", with its column aisle. */
async function changeTarget(admin: Client, user: ReturnType<typeof userEvent.setup>) {
  await admin.post('/api/table_def', { name: OTHER, columns: [{ column_name: 'aisle', column_type: 'Data' }] })
  const picker = within(form()).getByLabelText('Table', { exact: true })
  await user.clear(picker)
  fireEvent.change(picker, { target: { value: OTHER } })
  fireEvent.mouseDown(await within(form()).findByRole('button', { name: OTHER }))
}

async function hideAisle(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(within(form()).getByLabelText('Column', { exact: true })).toHaveTextContent('aisle'))
  await onForm((f) => f.selectOption('Column', 'aisle').selectOption('Setting', 'Hidden (hidden)').check('Value').clickButton('Save'))
}

// ---- A person's roles (#832) ----

async function newPerson(admin: Client) {
  return (await admin.post<{ row_id: string }>('/api/save_row', { table: 'Person', row: { email: 'nested-link@example.com', enabled: true } })).row_id
}
const rolesOf = async (admin: Client, person: string) =>
  ((await admin.get<{ roles?: { role: string }[] }>(`/api/table/Person/${enc(person)}`)).roles ?? []).map((r) => r.role)

async function addRole(admin: Client, person: string) {
  await renderApp(rowHref('Person', person), admin)
  fireEvent.click(await screen.findByTestId('add-row-roles'))
  return waitFor(() => {
    const cells = screen.getByTestId('table-roles').querySelectorAll<HTMLInputElement>('[data-childfield="role"]')
    expect(cells.length).toBeGreaterThan(0)
    return cells[cells.length - 1]!
  })
}

describe('core-forms', () => {
  scenario('Find a customer by a few letters', async ({ admin }, step) => {
    let offered: string[] = []
    let view!: View
    await step('the user is a System Manager', () => {})
    await step('orders from the customers "Globex Ltd" and "Initech"', () => ordersFromCustomers(admin))
    await step('the user types "Ltd" into a new order\'s customer and picks "Globex Ltd"', async () => {
      view = await renderApp(`${tableHref(ORDERS)}/new`, admin)
      await screen.findByTestId('form-view')
      fireEvent.focus(customerBox())
      fireEvent.change(customerBox(), { target: { value: 'Ltd' } })
      const options = await screen.findByTestId('link-options-customer')
      // The search runs a moment after typing; wait for its answer.
      await waitFor(() => expect(within(options).getAllByTestId('link-option').map((o) => (o.textContent ?? '').trim())).not.toContain('Initech'))
      await waitFor(() => expect(within(options).queryAllByTestId('link-option').length).toBeGreaterThan(0))
      offered = within(options).getAllByTestId('link-option').map((o) => (o.textContent ?? '').trim())
      fireEvent.mouseDown(within(options).getAllByTestId('link-option').find((o) => o.textContent?.includes('Globex Ltd'))!)
      await onForm((f) => f.fillIn('Item', 'Bolts').clickButton('Save'))
      await waitFor(() => expect(location(view).pathname.endsWith('/new')).toBe(false))
    })
    await step('the user was offered only "Globex Ltd"', () => expect(offered).toEqual(['Globex Ltd']))
    await step('the user sees the saved order\'s customer as "Globex Ltd"', async () => {
      await waitFor(() => expect(customerBox()).toHaveValue('Globex Ltd'))
      const saved = decodeURIComponent(location(view).pathname.split('/').pop()!)
      expect((await admin.get<{ customer: string; item: string }>(`/api/table/${enc(ORDERS)}/${enc(saved)}`)).customer).toBe('cust-1')
    })
  })

  scenario('The parcel leads with its label and its rack', async ({ admin, createUser }, step) => {
    const user = await blueBoxReader(admin, createUser as CreateUser, step)
    await step('the user opens that parcel', () => openParcel(user))
    await step('the user sees the parcel\'s fields in the order Label, Rack, Sender, Weight, Fragile, Instructions, Sent On and Photo', () =>
      waitFor(() => expect(fieldLabels()).toEqual(IMPORTANCE)))
  })

  scenario('The parcel counter keeps its two sections', async ({ admin, createUser }, step) => {
    let user!: Client
    await step('a parcel counter table its builder laid out in two sections', async () => {
      await admin.post('/api/table_def', {
        name: COUNTER, id_pattern: 'prompt',
        columns: [
          { column_name: 'sender', label: 'Sender', column_type: 'Data' },
          { column_name: 'handed_in_on', label: 'Handed In On', column_type: 'Date' },
          { column_name: 'details', label: 'Details', column_type: 'Section Break' },
          { column_name: 'weight', label: 'Weight', column_type: 'Float' },
          { column_name: 'shelf_note', label: 'Shelf Note', column_type: 'Data' },
        ],
      })
      await grantRole(admin, { role: 'Counter Reader', table: COUNTER, can_read: true })
      user = await (createUser as CreateUser)({ email: 'counter.reader@example.com', roles: ['Counter Reader'] })
    })
    await step('a parcel "Blue box" at the parcel counter', () =>
      admin.post(`/api/table/${enc(COUNTER)}`, { row_id: 'Blue box', sender: 'Front desk', handed_in_on: '2026-10-30', weight: 2.5, shelf_note: 'Top' }))
    await step('the user opens that parcel at the parcel counter', async () => {
      await renderApp(rowHref(COUNTER, 'Blue box'), user)
      await screen.findByTestId('form-view')
    })
    await step("the user sees its fields in the builder's two sections", async () => {
      const first = await screen.findByTestId('form-section-0')
      const second = await screen.findByTestId('form-section-1')
      for (const label of ['Sender', 'Handed In On']) expect(first.querySelector(`[data-form-field][data-label="${label}"]`), label).not.toBeNull()
      for (const label of ['Weight', 'Shelf Note']) expect(second.querySelector(`[data-form-field][data-label="${label}"]`), label).not.toBeNull()
    })
  })

  scenario("The parcel's empty note is folded away", async ({ admin, createUser }, step) => {
    const user = await blueBoxReader(admin, createUser as CreateUser, step)
    await step('the user opens that parcel', () => openParcel(user))
    await step('the user sees one empty field folded away', async () => {
      const line = await within(form()).findByTestId('empty-fields-toggle')
      expect(line.textContent).toMatch(/\b1\b/)
      expect(line).toHaveAttribute('aria-expanded', 'false')
    })
    await step("the user does not see the parcel's note", () => expect(field('Note')).toBeNull())
  })

  scenario("The parcel's note shows once its empty fields are opened", async ({ admin, createUser }, step) => {
    const user = await blueBoxReader(admin, createUser as CreateUser, step)
    await step('the user opens that parcel and opens its empty fields', async () => {
      await openParcel(user)
      fireEvent.click(await within(form()).findByTestId('empty-fields-toggle'))
    })
    await step("the user sees the parcel's note", () => waitFor(() => expect(field('Note')).not.toBeNull()))
  })

  scenario("The parcel's bookkeeping sits at its foot", async ({ admin, createUser }, step) => {
    const user = await blueBoxReader(admin, createUser as CreateUser, step)
    await step('the user opens that parcel', () => openParcel(user))
    await step('the user sees when the parcel was created and who updated it on one line below its other fields', async () => {
      const foot = await within(form()).findByTestId('bookkeeping-line')
      expect(foot.textContent).toMatch(/Created On/)
      expect(foot.textContent).toMatch(/Updated By\s+kiosk/)
      const shown = fieldLabels()
      expect(shown).not.toContain('Created On')
      expect(shown).not.toContain('Updated By')
      // Below every other field: after the last one in the page.
      const last = field(shown.at(-1)!)!
      expect(last.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  })

  scenario("The parcel's values read by their type", async ({ admin, createUser }, step) => {
    const user = await blueBoxReader(admin, createUser as CreateUser, step)
    await step('the user opens that parcel', () => openParcel(user))
    await step("the user sees each of the parcel's fields marked with its type", () => {
      for (const label of fieldLabels()) expect(typeMarkOf(label!), `${label} has a type mark`).toBeTruthy()
      expect(typeMarkOf('Weight')).toBe('number')
      expect(typeMarkOf('Fragile')).toBe('yesno')
    })
    await step("the user sees the parcel's weight in even-width figures", () => {
      expect((valueOf('Weight').textContent ?? '').trim()).toMatch(/^2\.5/)
      expect(valueOf('Weight')).toHaveClass('tabular-nums')
    })
    await step('the user sees the parcel marked as fragile', () => {
      expect(valueOf('Fragile')).toHaveAttribute('data-value', 'yesno')
      expect((valueOf('Fragile').textContent ?? '').trim()).toBe('Yes')
    })
    await step('the user sees the parcel\'s rack as "Top"', async () => {
      await waitFor(() => expect(within(valueOf('Rack')).getByText('Top', { exact: true })).toBeInTheDocument())
      expect(valueOf('Rack').querySelector('a') ?? valueOf('Rack').closest('a')).not.toBeNull()
    })
    await step('the user sees the parcel\'s photo as the file "blue-box.png"', () => {
      expect(valueOf('Photo')).toHaveAttribute('data-value', 'file')
      expect((valueOf('Photo').textContent ?? '').trim()).toBe('blue-box.png')
    })
  })

  scenario("The parcel's weight is grouped with the numbers", async ({ admin, createUser }, step) => {
    const user = await blueBoxReader(admin, createUser as CreateUser, step)
    await step('the user opens that parcel and arranges its fields by data type', async () => {
      await openParcel(user)
      await arrangeBy('type')
    })
    await step("the user sees the parcel's Weight grouped with the numbers", () => expect(groupOf('Weight')).toBe('number'))
    await step("the user sees the parcel's Rack grouped with the links", () => expect(groupOf('Rack')).toBe('link'))
  })

  scenario("The parcel's empty note comes after its filled fields", async ({ admin, createUser }, step) => {
    const user = await blueBoxReader(admin, createUser as CreateUser, step)
    await step('the user opens that parcel and arranges its filled fields first', async () => {
      await openParcel(user)
      await arrangeBy('filled')
    })
    await step("the user sees the parcel's note after every filled field", () => expect(fieldLabels().at(-1)).toBe('Note'))
  })

  scenario("The parcel's rack comes first", async ({ admin, createUser }, step) => {
    const user = await blueBoxReader(admin, createUser as CreateUser, step)
    await step('the user opens that parcel and arranges its links first', async () => {
      await openParcel(user)
      await arrangeBy('links')
    })
    await step("the user sees the parcel's Rack before every other field", () => expect(fieldLabels()[0]).toBe('Rack'))
  })

  scenario("The parcel's fields in its source's order", async ({ admin, createUser }, step) => {
    const user = await blueBoxReader(admin, createUser as CreateUser, step)
    await step("the user opens that parcel and arranges its fields in the table's own order", async () => {
      await openParcel(user)
      await arrangeBy('source')
    })
    await step("the user sees the parcel's fields in the order Created On, Label, Weight, Note, Fragile, Instructions, Sent On, Photo, Sender, Rack and Updated By", () =>
      expect(fieldLabels()).toEqual(['Created On', 'Label', 'Weight', 'Note', 'Fragile', 'Instructions', 'Sent On', 'Photo', 'Sender', 'Rack', 'Updated By']))
  })

  scenario("The parcel's fields in one column", async ({ admin, createUser }, step) => {
    const user = await blueBoxReader(admin, createUser as CreateUser, step)
    await step('the user opens that parcel and shows its fields in one column', async () => {
      await openParcel(user)
      fireEvent.click(within(form()).getByTestId('arrange-columns-1'))
      await waitFor(async () =>
        expect((await user.get<{ settings: { form?: { columns?: number } } | null }>('/api/user_settings/Parcel')).settings?.form?.columns).toBe(1))
    })
    await step("the user sees each of the parcel's fields below the one before", () => oneColumn())
  })

  scenario('The parcel opens as the user left it', async ({ admin, createUser }, step) => {
    const user = await blueBoxReader(admin, createUser as CreateUser, step)
    await step("the user arranged the parcel's fields by data type in one column", async () => {
      await openParcel(user)
      await arrangeBy('type')
      fireEvent.click(within(form()).getByTestId('arrange-columns-1'))
      // Done once the person's settings have taken the choice.
      await waitFor(async () =>
        expect((await user.get<{ settings: { form?: unknown } | null }>('/api/user_settings/Parcel')).settings?.form).toEqual({ mode: 'type', columns: 1 }))
    })
    await step('the user opens that parcel again', async () => {
      // A new browser: only what is kept for the person, not for this browser, comes back.
      signInAfresh()
      await openParcel(user)
    })
    await step("the user sees the parcel's Weight grouped with the numbers", () =>
      waitFor(() => expect(groupOf('Weight')).toBe('number')))
    await step("the user sees each of the parcel's fields below the one before", () => oneColumn())
  })

  scenario("A colleague's parcel still opens by importance", async ({ admin, createUser }, step) => {
    const user = await blueBoxReader(admin, createUser as CreateUser, step)
    let colleague!: Client
    await step("the user arranged the parcel's fields by data type in one column", async () => {
      await openParcel(user)
      await arrangeBy('type')
      fireEvent.click(within(form()).getByTestId('arrange-columns-1'))
      await waitFor(async () =>
        expect((await user.get<{ settings: { form?: unknown } | null }>('/api/user_settings/Parcel')).settings?.form).toEqual({ mode: 'type', columns: 1 }))
    })
    await step('a colleague may read parcels and racks', async () => {
      colleague = await parcelReader(admin, createUser as CreateUser, 'parcel.colleague@example.com')
    })
    await step('a colleague opens that parcel', () => openParcel(colleague))
    await step("the colleague sees the parcel's fields in the order Label, Rack, Sender, Weight, Fragile, Instructions, Sent On and Photo", () =>
      waitFor(() => expect(fieldLabels()).toEqual(IMPORTANCE)))
  })

  scenario('Hide a column without naming the adjustment', async ({ admin }, step) => {
    const user = userEvent.setup()
    let view!: View
    let id = ''
    await step('the user can adjust a Table with a column called "floor"', async () => {
      await shelf(admin)
      view = await newAdjustment(admin)
    })
    await step('the user saves an adjustment that hides "floor"', async () => {
      id = await saveHidden(user, view, 'floor')
    })
    await step('the adjustment is saved without the user supplying an ID', async () => {
      const row = await admin.get<{ row_id: string; value: string }>(`/api/table/Metadata%20Override/${enc(id)}`)
      expect(row.row_id).toBeTruthy()
      expect(row.value).toBe('true')
    })
    await step('the saved adjustment identifies its Table, "floor" and "hidden"', async () =>
      waitFor(() => expect(within(form()).getAllByRole('heading', { level: 1 })[0]).toHaveTextContent(`${SHELF} · floor · hidden`)))
    await step('the user can open the affected Table from the saved adjustment', async () => {
      await user.click(within(form()).getByRole('link', { name: `Open Table: ${SHELF}` }))
      expect(await screen.findByTestId('list-view')).toBeVisible()
      expect(await columnHidden(admin, SHELF, 'floor')).toBe(true)
    })
  })

  scenario('A different target requires a fresh selection', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('the user is preparing an adjustment that hides "floor"', async () => {
      await shelf(admin)
      await newAdjustment(admin)
      await chooseHidden(user, 'floor')
    })
    await step('the user chooses a different Table for the adjustment', () => changeTarget(admin, user))
    await step('the old column, setting and value are cleared', async () => {
      await waitFor(() => expect(within(form()).getByLabelText('Column', { exact: true })).toHaveValue(''))
      expect(within(form()).getByLabelText('Setting', { exact: true })).toHaveValue('')
      const value = within(form()).getByLabelText('Value', { exact: true }) as HTMLInputElement
      if (value.type === 'checkbox') expect(value).not.toBeChecked()
      else expect(value).toHaveValue('')
      expect(within(form()).getByLabelText('Setting', { exact: true })).toBeDisabled()
    })
  })

  scenario('Whole-Table adjustments remain available', async ({ admin }, step) => {
    let view!: View
    let id = ''
    await step('the user can adjust a Table with a column called "floor"', async () => {
      await shelf(admin)
      view = await newAdjustment(admin)
    })
    await step('the user saves a label adjustment for the whole Table', async () => {
      await waitFor(() => expect(within(form()).getByLabelText('Column', { exact: true })).toHaveTextContent('Whole Table'))
      await onForm((f) => f.selectOption('Column', 'Whole Table'))
      const setting = within(form()).getByLabelText('Setting', { exact: true })
      await waitFor(() => expect([...setting.querySelectorAll('option')].map((o) => o.textContent)).toContain('Label (label)'))
      expect([...setting.querySelectorAll('option')].map((o) => o.textContent)).not.toContain('Hidden (hidden)')
      await onForm((f) => f.selectOption('Setting', 'Label (label)').fillIn('Value', 'Storage shelf').clickButton('Save'))
      await screen.findByRole('link', { name: `Open Table: ${SHELF}` })
      id = decodeURIComponent(location(view).pathname.split('/').pop()!)
    })
    await step('the adjustment is saved for the whole Table rather than a column', async () => {
      const row = await admin.get<{ column_name: string | null; property: string; value: string }>(`/api/table/Metadata%20Override/${enc(id)}`)
      expect(row.column_name).toBeFalsy()
      expect(row.property).toBe('label')
      expect(row.value).toBe('Storage shelf')
    })
  })

  scenario('A second adjustment cannot compete with the first', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('the user has saved an adjustment that hides "floor"', async () => {
      await shelf(admin)
      await saveHidden(user, await newAdjustment(admin), 'floor')
    })
    await step('the user tries to add the same adjustment again', async () => {
      await newAdjustment(admin)
      await chooseHidden(user, 'floor')
      await onForm((f) => f.clickButton('Save'))
    })
    await step('the user is told to edit the existing adjustment', () =>
      onForm((f) => f.assertText('Edit the existing adjustment')))
    await step('only the original adjustment is saved', async () =>
      expect((await overrideRows(admin, [['table_name', '=', SHELF]])).data).toHaveLength(1))
  })

  scenario('A move cannot replace another adjustment', async ({ admin }, step) => {
    const user = userEvent.setup()
    let id = ''
    await step('the user has saved an adjustment that hides "floor"', async () => {
      await shelf(admin)
      id = await saveHidden(user, await newAdjustment(admin), 'floor')
    })
    await step('the user tries to move it to a setting that already has an adjustment', async () => {
      await changeTarget(admin, user)
      await admin.post('/api/table/Metadata%20Override', { table_name: OTHER, column_name: 'aisle', property: 'hidden', value: 'false' })
      await hideAisle(user)
    })
    await step('the user is told to edit the existing adjustment', () =>
      onForm((f) => f.assertText('Edit the existing adjustment')))
    await step('the original adjustment stays on its previous Table', async () => {
      const row = await admin.get<{ table_name: string; column_name: string; value: string }>(`/api/table/Metadata%20Override/${enc(id)}`)
      expect(row).toMatchObject({ table_name: SHELF, column_name: 'floor', value: 'true' })
    })
  })

  scenario('Only the new target keeps the adjustment', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('the user has saved an adjustment that hides "floor"', async () => {
      await shelf(admin)
      await saveHidden(user, await newAdjustment(admin), 'floor')
    })
    await step('the user moves the adjustment to another Table', async () => {
      // Warm the served metadata before moving, rather than testing a cold read.
      expect(await columnHidden(admin, SHELF, 'floor')).toBe(true)
      await changeTarget(admin, user)
      await hideAisle(user)
      await screen.findByRole('link', { name: `Open Table: ${OTHER}` })
    })
    await step('the old Table no longer hides its column', async () => expect(await columnHidden(admin, SHELF, 'floor')).toBeFalsy())
    await step('the new Table hides the selected column', async () => expect(await columnHidden(admin, OTHER, 'aisle')).toBe(true))
  })

  scenario('A role is picked from the roles that exist', async ({ admin }, step) => {
    let person = ''
    let cell!: HTMLInputElement
    let offered: string[] = []
    await step('the user is adding a role to a person', async () => {
      person = await newPerson(admin)
      cell = await addRole(admin, person)
    })
    await step('the user types "Sys" into the new role and picks "System Manager"', async () => {
      fireEvent.focus(cell)
      fireEvent.change(cell, { target: { value: 'Sys' } })
      const options = await screen.findByTestId('link-options-role')
      const pick = await waitFor(() => within(options).getAllByTestId('link-option').find((o) => o.textContent?.includes('System Manager'))!)
      offered = within(options).getAllByTestId('link-option').map((o) => o.textContent ?? '')
      fireEvent.mouseDown(pick)
    })
    await step('only roles matching "Sys" were offered', () => {
      expect(offered.length).toBeGreaterThan(0)
      for (const name of offered) expect(name).toMatch(/Sys/i)
    })
    await step('after saving, the person has the System Manager role', async () => {
      fireEvent.click(screen.getByTestId('form-save'))
      await waitFor(() => expect(screen.getByTestId('form-save')).toBeDisabled())
      expect(await rolesOf(admin, person)).toEqual(['System Manager'])
    })
  })

  scenario('A typed role that was never picked is not saved', async ({ admin }, step) => {
    let person = ''
    let cell!: HTMLInputElement
    await step('the user is adding a role to a person', async () => {
      person = await newPerson(admin)
      cell = await addRole(admin, person)
    })
    await step('the user types "Store Boss" into the new role without picking one', async () => {
      fireEvent.focus(cell)
      fireEvent.change(cell, { target: { value: 'Store Boss' } })
      fireEvent.blur(cell)
      fireEvent.click(within(form()).getAllByRole('heading')[0]!)
    })
    await step('the person cannot be saved until the role is picked', async () => {
      fireEvent.click(screen.getByTestId('form-save'))
      await waitFor(() => expect(within(screen.getByTestId('table-roles')).getAllByText(/required|pick|choose/i)[0]).toBeInTheDocument())
      expect(screen.getByTestId('form-save')).toBeEnabled()
    })
    await step('the person has no Store Boss role', async () => expect(await rolesOf(admin, person)).toEqual([]))
  })

  scenario('Read a configured reference notice', async ({ admin }, step) => {
    await step('the user can read a reference notice with a configured reading presentation', async () => {
      await admin.post('/api/table_def', {
        name: 'Reference Notice', reading_presentation: { title: 'title', headers: ['count'], body: 'message' },
        columns: [
          { column_name: 'title', column_type: 'Data' },
          { column_name: 'count', column_type: 'Int' },
          { column_name: 'message', column_type: 'Text' },
        ],
      })
      await admin.post('/api/table/Reference%20Notice', { row_id: 'notice', title: 'Reference title', count: 7, message: 'Reference body' })
      // A Table the platform writes: read-only to people, so it reads as configured.
      await sql`update featherbase.table_def set system_written = true where name = 'Reference Notice'`
      await admin.post('/api/table_def', {
        name: 'Writable Notice', reading_presentation: { title: 'title', headers: [], body: 'message' },
        columns: [
          { column_name: 'title', column_type: 'Data' },
          { column_name: 'message', column_type: 'Text' },
        ],
      })
      await admin.post('/api/table/Writable%20Notice', { row_id: 'notice', title: 'Editable title', message: 'Editable body' })
      // The effective metadata is read afresh after the Table was changed underneath it.
      invalidateMeta()
    })
    await step('the user opens the reference notice', () => renderApp(rowHref('Reference Notice', 'notice'), admin))
    await step('the reference notice uses its configured reading presentation', async () => {
      const reading = await screen.findByTestId('reading-presentation')
      await waitFor(() => expect(reading).toHaveTextContent('Reference title'))
      expect(reading).toHaveTextContent('Reference body')
      expect(reading).not.toHaveTextContent('Email Sink')
    })
    await step('the ordinary editable reference form remains available for writable rows', async () => {
      cleanup()
      await renderApp(rowHref('Writable Notice', 'notice'), admin)
      await waitFor(() => expect(document.querySelector('[data-field="message"]')).toBeEnabled())
      expect(screen.queryByTestId('reading-presentation')).not.toBeInTheDocument()
      expect(screen.getByTestId('form-save')).toBeVisible()
    })
  })
})
