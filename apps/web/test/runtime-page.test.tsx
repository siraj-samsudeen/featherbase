// A runtime page's parts and states, below the spec's scenarios
// (test/scenarios/runtime-pages.test.tsx): each part's settings, each action,
// and what the page says while rows load or cannot be read (#1410). The page
// in jsdom, its rows from the real in-process server. Made-up data: a shop.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { pageHref, rowHref, type PageDefinition, type PagePart } from 'shared'
import { sql } from 'server/src/db'
import { tableName } from 'server/src/platform-schema'
import { grantRole, makeTable, tableRef } from 'server/test/fixtures'
import { recordAction } from '../src/lib/recents'
import { holdResponses } from './held-requests'
import { test, expect, renderApp } from './pg-test'

const NAME = 'shop-page'
const WAIT = { timeout: 8000 }
/** A definition: the heading "Shop Page" over `children`, with `parts` to draw them from. */
const definition = (children: string[], parts: PagePart[], more: Partial<PageDefinition> = {}): PageDefinition => ({
  version: '1.0',
  components: [{ id: 'root', component: 'Page', title: 'Shop Page', children }, ...parts],
  ...more,
})
const SAMPLE = { lines: { sample: [
  { item: 'Notebook A5', category: 'Stationery', sold_qty: 820, price: 20, listed_on: '2026-12-01' },
  { item: 'Gel Pen', category: 'Stationery', sold_qty: 690, price: 10, listed_on: '2026-12-02' },
  { item: 'Salted Crisps', category: 'Snacks', sold_qty: 300, price: 30, listed_on: '2026-12-03' },
] } }
const text = (id: string, more: Record<string, unknown> = {}): PagePart => ({ id, component: 'Text', text: `The ${id} line`, ...more })

/** Save the page as a System Manager and open it. */
async function show(admin: TestClient, def: PageDefinition, query = '', as: TestClient = admin) {
  await admin.post('/api/table/Page', { row_id: NAME, title: 'Shop Page', module: 'Shop', status: 'Published', definition: def })
  const app = await renderApp(`${pageHref(NAME)}${query}`, as)
  await screen.findByRole('heading', { level: 1, name: 'Shop Page' }, WAIT)
  return app
}
const address = (app: Awaited<ReturnType<typeof renderApp>>) => (app.router.state as { location: { href: string } }).location.href

describe('layout parts', () => {
  test('a Stack draws its parts one under another, in the order it names them', async ({ admin }) => {
    await show(admin, definition(['stack'], [{ id: 'stack', component: 'Stack', children: ['second', 'first'] }, text('first'), text('second')]))
    const stack = screen.getByText('The second line').parentElement!
    expect([...stack.children].map((child) => child.textContent)).toEqual(['The second line', 'The first line'])
    expect(stack.className).toMatch(/\bflex-col\b/)
  })

  test.for([['small', 'gap-2'], ['medium', 'gap-4'], ['large', 'gap-6'], [undefined, 'gap-4']] as const)('a Stack with gap %s spaces its parts with %s', async ([gap, spacing], { admin }) => {
    await show(admin, definition(['stack'], [{ id: 'stack', component: 'Stack', children: ['first'], ...(gap ? { gap } : {}) }, text('first')]))
    expect(screen.getByText('The first line').parentElement!.className.split(' ')).toContain(spacing)
  })

  test.for([['start', 'justify-start'], ['center', 'justify-center'], ['end', 'justify-end'], ['between', 'justify-between'], [undefined, 'justify-start']] as const)('a Row aligned %s sets its parts side by side with %s', async ([align, justify], { admin }) => {
    await show(admin, definition(['row'], [{ id: 'row', component: 'Row', children: ['first', 'second'], ...(align ? { align } : {}) }, text('first'), text('second')]))
    const row = screen.getByText('The first line').parentElement!
    expect(row.className.split(' ')).toEqual(expect.arrayContaining(['flex', justify]))
    expect(row.className).not.toMatch(/\bflex-col\b/)
  })
})

describe('parts that show', () => {
  test('a Text set as a heading is a heading under the page\'s own', async ({ admin }) => {
    await show(admin, definition(['intro'], [text('intro', { variant: 'heading' })]))
    expect(screen.getByRole('heading', { level: 2, name: 'The intro line' })).toBeInTheDocument()
  })

  test.for([['caption', 'text-ink-subtle'], ['figure', 'tabular-nums'], ['body', 'text-ink']] as const)('a Text set as %s reads as one (%s)', async ([variant, look], { admin }) => {
    await show(admin, definition(['intro'], [text('intro', { variant })]))
    expect(screen.getByText('The intro line').className.split(' ')).toContain(look)
  })

  test('words that only look like a path into rows are drawn as they are written', async ({ admin }) => {
    await show(admin, definition(['intro'], [{ id: 'intro', component: 'Text', text: 'Write ${/data/prices/0/item} to put a value in' }]))
    expect(screen.getByText('Write ${/data/prices/0/item} to put a value in')).toBeInTheDocument()
  })

  test('a Notice is a message set apart from the page, and says what it is told to', async ({ admin }) => {
    await show(admin, definition(['note'], [{ id: 'note', component: 'Notice', text: 'Prices change on Monday' }]))
    expect(within(screen.getByTestId('runtime-page')).getByRole('status')).toHaveTextContent('Prices change on Monday')
  })

  test('a negative Notice interrupts as an alert', async ({ admin }) => {
    await show(admin, definition(['note'], [{ id: 'note', component: 'Notice', tone: 'negative', text: 'The count is overdue' }]))
    expect(screen.getByRole('alert')).toHaveTextContent('The count is overdue')
  })
})

const MEASURE: PagePart = {
  id: 'measure', component: 'Toggle', label: 'Show', value: { '@path': '/state/measure' },
  options: [{ value: 'quantity', label: 'Quantity' }, { value: 'value', label: 'Value' }],
}
const table = (more: Record<string, unknown>): PagePart => ({ id: 'plan', component: 'Table', caption: 'Shop items', rows: { '@path': '/data/lines' }, ...more })
const ITEM = { id: 'item', header: 'Item', value: { '@path': 'item' } }
const SOLD = { id: 'sold', header: 'Sold', align: 'end', format: 'number', total: 'sum', value: { '@path': 'sold_qty' } }
const PRICE = { id: 'price', header: 'Price', align: 'end', format: 'currency', total: 'sum', value: { '@path': 'price' } }
const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent)
const line = (name: string) => screen.getByRole('row', { name: new RegExp(name) })

describe('the Page part', () => {
  test('parts named in its actions sit on the heading\'s line', async ({ admin }) => {
    await show(admin, { ...definition(['intro'], [MEASURE, text('intro')], { state: { measure: 'quantity' } }), components: [{ id: 'root', component: 'Page', title: 'Shop Page', actions: ['measure'], children: ['intro'] }, MEASURE, text('intro')] })
    expect(within(screen.getByTestId('page-header-actions')).getByRole('group', { name: 'Show' })).toBeInTheDocument()
  })

  test('a page with no sample rows does not say it shows sample data', async ({ admin }) => {
    await show(admin, definition(['intro'], [text('intro')]))
    expect(screen.queryByText(/Sample data/)).not.toBeInTheDocument()
  })

  test('a part repeated over a source is drawn once per row, reading that row', async ({ admin }) => {
    await show(admin, definition(['cards'], [
      { id: 'cards', component: 'Stack', children: { componentId: 'card', path: '/data/lines' } },
      { id: 'card', component: 'Text', text: { '@call': 'formatString', args: { value: '${item} in ${category}' } } },
    ], { data: SAMPLE }))
    expect([...screen.getByText('Notebook A5 in Stationery').parentElement!.children].map((child) => child.textContent))
      .toEqual(['Notebook A5 in Stationery', 'Gel Pen in Stationery', 'Salted Crisps in Snacks'])
  })
})

describe('the Table part', () => {
  test('a column is drawn only while it is visible, and a band shrinks to its columns that are', async ({ admin }) => {
    const price = { ...PRICE, visible: { '@call': 'eq', args: { a: { '@path': '/state/measure' }, b: 'value' } } }
    await show(admin, definition(['measure', 'plan'], [MEASURE, table({ columns: [ITEM, SOLD, price], bands: [{ label: 'Last Month', columns: ['sold', 'price'] }] })], { state: { measure: 'quantity' }, data: SAMPLE }))
    expect([headers(), screen.getByRole('columnheader', { name: 'Last Month' }).getAttribute('colspan')]).toEqual([['Last Month', 'Item', 'Sold'], '1'])
    fireEvent.click(screen.getByRole('button', { name: 'Value' }))
    await waitFor(() => expect([headers(), screen.getByRole('columnheader', { name: 'Last Month' }).getAttribute('colspan')]).toEqual([['Last Month', 'Item', 'Sold', 'Price'], '2']))
  })

  test('a later column that draws a part in each row is given more room than a figure, and the shares are set before any row is drawn', async ({ admin }) => {
    await show(admin, definition(['plan'], [table({ columns: [{ id: 'item', header: 'Item', cell: 'name' }, SOLD, { id: 'plan', header: 'Plan', cell: 'name' }], group_by: 'category' }), says('name', '${item}')], { data: SAMPLE }))
    expect([...document.querySelectorAll('col')].map((col) => col.style.width)).toEqual(['33.3333%', '16.6667%', '50%'])
  })

  test('a figure reads as its column\'s format says', async ({ admin }) => {
    await show(admin, definition(['plan'], [table({ columns: [ITEM, SOLD, PRICE, { id: 'listed', header: 'Listed', format: 'date', value: { '@path': 'listed_on' } }] })], { data: SAMPLE }))
    expect(within(line('Notebook A5')).getAllByRole('cell').map((td) => td.textContent)).toEqual(['820', '₹20.00', '01-Dec-2026'])
  })

  test('a header may be worked out from the page\'s state', async ({ admin }) => {
    const sold = { ...SOLD, header: { '@call': 'formatString', args: { value: 'Sold by ${/state/measure}' } } }
    await show(admin, definition(['plan'], [table({ columns: [ITEM, sold] })], { state: { measure: 'quantity' }, data: SAMPLE }))
    expect(headers()).toEqual(['Item', 'Sold by quantity'])
  })

  test('rows are told apart by the column the table names', async ({ admin }) => {
    await show(admin, definition(['plan'], [table({ columns: [ITEM, SOLD], row_key: 'item' })], { data: SAMPLE }))
    expect(line('Gel Pen')).toHaveAttribute('data-row', 'Gel Pen')
  })

  test('a table with no rows says so', async ({ admin }) => {
    await shopItems(admin)
    await show(admin, definition(['plan'], [table({ columns: [ITEM] })], { data: { lines: { table: 'Shop Item', filters: [['category', '=', 'Toys']] } } }))
    await waitFor(() => expect(screen.getByRole('table', { name: 'Shop items' })).toHaveTextContent('Nothing to show'), WAIT)
  })

  test('a group\'s total of money reads as money, and a column with no total is left empty', async ({ admin }) => {
    await show(admin, definition(['plan'], [table({ columns: [ITEM, { ...SOLD, total: undefined }, PRICE], group_by: 'category' })], { data: SAMPLE }))
    expect(within(line('Stationery')).getAllByRole('cell').map((td) => td.textContent)).toEqual(['', '₹30.00'])
  })

  test('with no state bound to its open group, a table still opens one group at a time and the address stays as it was', async ({ admin }) => {
    const app = await show(admin, definition(['plan'], [table({ columns: [ITEM, SOLD], group_by: 'category' })], { data: SAMPLE }))
    fireEvent.click(screen.getByRole('button', { name: 'Stationery' }))
    expect(screen.getByText('Notebook A5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Snacks' }))
    expect([screen.queryByText('Notebook A5'), screen.getByText('Salted Crisps').textContent, address(app)]).toEqual([null, 'Salted Crisps', pageHref(NAME)])
  })

  test('opening another group closes the first, and closing the open one leaves the address clean', async ({ admin }) => {
    const app = await show(admin, definition(['plan'], [table({ columns: [ITEM, SOLD], group_by: 'category', open: { '@path': '/state/open' } })], { state: { open: '' }, data: SAMPLE }), '?open=Stationery')
    expect(screen.getByText('Notebook A5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Snacks' }))
    await waitFor(() => expect([screen.queryByText('Notebook A5'), screen.getByText('Salted Crisps').textContent, address(app)]).toEqual([null, 'Salted Crisps', `${pageHref(NAME)}?open=Snacks`]))
    fireEvent.click(screen.getByRole('button', { name: 'Snacks' }))
    await waitFor(() => expect([screen.queryByText('Salted Crisps'), address(app)]).toEqual([null, pageHref(NAME)]))
  })
})

const ITEMS = tableRef('Shop Item')
/** A Table of the shop's items with two rows; answers their ids by name. */
async function shopItems(admin: TestClient): Promise<Record<string, string>> {
  await makeTable(admin, { name: 'Shop Item', module: 'Shop', title_column: 'item', columns: ['item', 'category', 'planned_qty:Int'] })
  const ids: Record<string, string> = {}
  for (const [item, category] of [['Notebook A5', 'Stationery'], ['Salted Crisps', 'Snacks']])
    ids[item!] = (await admin.post<{ row_id: string }>(ITEMS.url, { item, category })).row_id
  return ids
}
const ITEM_LINK: PagePart = { id: 'item_link', component: 'RecordLink', table: 'Shop Item', row: { '@path': 'row_id' }, label: { '@path': 'item' } }
const ITEM_ROWS = { lines: { table: 'Shop Item', order_by: 'item asc' } }

describe('the RecordLink part', () => {
  test('a record the viewer may read is a link that opens its own page', async ({ admin }) => {
    const ids = await shopItems(admin)
    const app = await show(admin, definition(['plan'], [table({ columns: [{ id: 'item', header: 'Item', cell: 'item_link' }] }), ITEM_LINK], { data: ITEM_ROWS }))
    const link = await screen.findByRole('link', { name: 'Notebook A5' }, WAIT)
    expect([link.getAttribute('href'), link.getAttribute('data-record-link')]).toEqual([rowHref('Shop Item', ids['Notebook A5']!), 'link'])
    fireEvent.click(link)
    await waitFor(() => expect(address(app)).toBe(rowHref('Shop Item', ids['Notebook A5']!)))
  })

  test('a record of a Table the viewer may not read is plain text, in the same words', async ({ admin, createUser }) => {
    await shopItems(admin)
    await makeTable(admin, { name: 'Shop Supplier', module: 'Shop', columns: ['supplier'] })
    await grantRole(admin, { role: 'Shop Floor', table: 'Shop Item', can_read: true })
    await show(admin, definition(['supplier'], [{ id: 'supplier', component: 'RecordLink', table: 'Shop Supplier', row: 'SUP-1', label: 'Paper Mill' }]), '', await createUser({ roles: ['Shop Floor'] }))
    expect([screen.getByText('Paper Mill').closest('[data-record-link]')!.getAttribute('data-record-link'), screen.queryByRole('link', { name: 'Paper Mill' })]).toEqual(['text', null])
  })

  test('a row with no id of its own cannot be opened, so it is plain text', async ({ admin }) => {
    await shopItems(admin)
    await show(admin, definition(['plan'], [table({ columns: [{ id: 'item', header: 'Item', cell: 'item_link' }] }), ITEM_LINK], { data: { lines: { sample: [{ row_id: null, item: 'Loose Leaf' }] } } }))
    expect(screen.getByText('Loose Leaf').closest('[data-record-link]')).toHaveAttribute('data-record-link', 'text')
  })
})

/** A table of sample rows whose one cell holds `parts`, drawn in each row. */
const cells = (parts: PagePart[], rows: Record<string, unknown>[]) => definition(['plan'], [
  table({ columns: [ITEM, { id: 'plan', header: 'Plan', cell: 'cell' }] }),
  { id: 'cell', component: 'Row', children: parts.map((part) => part.id) },
  ...parts,
], { data: { lines: { sample: rows } } })
const says = (id: string, value: unknown): PagePart => ({ id, component: 'Text', text: { '@call': 'formatString', args: { value } } })

describe('the Input part', () => {
  test('outside a table it carries its label beside it, and what is typed goes where it is bound', async ({ admin }) => {
    const app = await show(admin, definition(['find'], [{ id: 'find', component: 'Input', label: 'Find', placeholder: 'An item', value: { '@path': '/state/find' } }], { state: { find: '' } }))
    const box = screen.getByLabelText('Find')
    expect([screen.getByText('Find').tagName, box.getAttribute('placeholder')]).toEqual(['LABEL', 'An item'])
    fireEvent.change(box, { target: { value: 'pen' } })
    await waitFor(() => expect([address(app), screen.getByLabelText<HTMLInputElement>('Find').value]).toEqual([`${pageHref(NAME)}?find=pen`, 'pen']))
  })

  test('what is typed shows in its box and nowhere else: the row\'s own cells and its group\'s total keep the saved values', async ({ admin }) => {
    const input: PagePart = { id: 'qty', component: 'Input', label: 'Planned quantity', kind: 'number', value: { '@path': 'planned_qty' } }
    const planned = { id: 'planned', header: 'Planned', align: 'end', format: 'number', total: 'sum', value: { '@path': 'planned_qty' } }
    await show(admin, definition(['plan'], [
      table({ columns: [ITEM, planned, { id: 'box', header: 'Change', cell: 'cell' }], group_by: 'category', open: { '@path': '/state/open' } }),
      { id: 'cell', component: 'Row', children: ['qty', 'now'] }, input, says('now', 'now ${planned_qty}'),
    ], { state: { open: '' }, data: { lines: { sample: [{ item: 'Notebook A5', category: 'Stationery', planned_qty: 600 }, { item: 'Gel Pen', category: 'Stationery', planned_qty: 400 }] } } }), '?open=Stationery')
    fireEvent.change(within(line('Notebook A5')).getByLabelText('Planned quantity'), { target: { value: '1.5' } })
    expect(within(line('Notebook A5')).getByLabelText<HTMLInputElement>('Planned quantity').value).toBe('1.5')
    expect(within(line('Notebook A5')).getAllByRole('cell').map((td) => td.textContent)).toEqual(['600', 'now 600'])
    expect(within(line('Stationery')).getAllByRole('cell')[0]).toHaveTextContent(/^1,000$/)
  })

  test('a box that is emptied stays empty, and the row still shows what is saved', async ({ admin }) => {
    const input: PagePart = { id: 'qty', component: 'Input', label: 'Planned quantity', kind: 'number', value: { '@path': 'planned_qty' } }
    await show(admin, cells([input, says('shown', { '@call': 'formatNumber', args: { value: { '@path': 'planned_qty' } } })], [{ item: 'Notebook A5', planned_qty: 600 }]))
    expect(screen.getByLabelText<HTMLInputElement>('Planned quantity').value).toBe('600')
    fireEvent.change(screen.getByLabelText('Planned quantity'), { target: { value: '' } })
    expect([screen.getByLabelText<HTMLInputElement>('Planned quantity').value, within(line('Notebook A5')).getAllByRole('cell')[0]!.textContent]).toEqual(['', '600'])
  })

  test('a number Input is a number box, and a text Input a text box', async ({ admin }) => {
    await show(admin, cells([
      { id: 'qty', component: 'Input', label: 'Planned quantity', kind: 'number', value: { '@path': 'planned_qty' } },
      { id: 'note', component: 'Input', label: 'Note', value: { '@path': 'note' } },
    ], [{ item: 'Notebook A5', planned_qty: 600, note: 'reorder early' }]))
    expect([screen.getByLabelText('Planned quantity').getAttribute('type'), screen.getByLabelText<HTMLInputElement>('Note').type, screen.getByLabelText<HTMLInputElement>('Note').value]).toEqual(['number', 'text', 'reorder early'])
  })

  test('what is typed into one row stays in that row', async ({ admin }) => {
    const input: PagePart = { id: 'qty', component: 'Input', label: 'Planned quantity', kind: 'number', value: { '@path': 'planned_qty' } }
    await show(admin, cells([input], [{ item: 'Notebook A5', planned_qty: null }, { item: 'Gel Pen', planned_qty: null }]))
    fireEvent.change(within(line('Gel Pen')).getByLabelText('Planned quantity'), { target: { value: '650' } })
    expect(screen.getAllByLabelText<HTMLInputElement>('Planned quantity').map((box) => box.value)).toEqual(['', '650'])
  })
})

const button = (id: string, label: unknown, name: string, context: Record<string, unknown>, more: Record<string, unknown> = {}): PagePart =>
  ({ id, component: 'Button', label, action: { event: { name, context } }, ...more })

describe('the Button part', () => {
  test.for([['primary', 'bg-action'], ['quiet', 'bg-transparent'], [undefined, 'bg-fill']] as const)('a %s button has the shared look (%s)', async ([variant, look], { admin }) => {
    await show(admin, definition(['go'], [button('go', 'Show Values', 'set_state', { values: { measure: 'value' } }, variant ? { variant } : {})], { state: { measure: 'quantity' } }))
    expect(screen.getByRole('button', { name: 'Show Values' }).className.split(' ')).toContain(look)
  })

  test('its label may be worked out from the page', async ({ admin }) => {
    await show(admin, definition(['go'], [button('go', { '@call': 'formatString', args: { value: 'Leave ${/state/measure}' } }, 'set_state', { values: { measure: 'value' } })], { state: { measure: 'quantity' } }))
    expect(screen.getByRole('button', { name: 'Leave quantity' })).toBeInTheDocument()
  })
})

describe('actions', () => {
  test('set_state changes the page\'s state, in the address, and every part that reads it follows', async ({ admin }) => {
    const app = await show(admin, definition(['go', 'now'], [button('go', 'Show Values', 'set_state', { values: { measure: 'value' } }), says('now', 'Showing ${/state/measure}')], { state: { measure: 'quantity' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Show Values' }))
    expect(await screen.findByText('Showing value')).toBeInTheDocument()
    expect(address(app)).toBe(`${pageHref(NAME)}?measure=value`)
  })

  test('open_page goes to another page, in the state it is given', async ({ admin }) => {
    await admin.post('/api/table/Page', { row_id: 'shop-detail', title: 'Shop Detail', module: 'Shop', status: 'Published', definition: {
      version: '1.0', state: { item: '' },
      components: [{ id: 'root', component: 'Page', title: 'Shop Detail', children: ['which'] }, says('which', 'About ${/state/item}')],
    } })
    const app = await show(admin, cells([button('go', 'Details', 'open_page', { page: 'shop-detail', state: { item: { '@path': 'item' } } })], [{ item: 'Gel Pen' }]))
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(await screen.findByText('About Gel Pen', {}, WAIT)).toBeInTheDocument()
    expect((app.router.state as { location: { pathname: string; search: unknown } }).location).toMatchObject({ pathname: pageHref('shop-detail'), search: { item: 'Gel Pen' } })
  })

  test('open_page with no state opens the page as it starts', async ({ admin }) => {
    await admin.post('/api/table/Page', { row_id: 'shop-detail', title: 'Shop Detail', module: 'Shop', status: 'Published', definition: definition(['intro'], [text('intro')]) })
    const app = await show(admin, definition(['go'], [button('go', 'Details', 'open_page', { page: 'shop-detail' })]))
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    await waitFor(() => expect(address(app)).toBe(pageHref('shop-detail')))
  })

  test('open_record goes to the row\'s own page', async ({ admin }) => {
    const ids = await shopItems(admin)
    const app = await show(admin, definition(['plan'], [
      table({ columns: [ITEM, { id: 'go', header: 'Open', cell: 'go' }] }),
      button('go', 'Open', 'open_record', { table: 'Shop Item', row: { '@path': 'row_id' } }),
    ], { data: ITEM_ROWS }))
    fireEvent.click(within(await screen.findByRole('row', { name: /Notebook A5/ }, WAIT)).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(address(app)).toBe(rowHref('Shop Item', ids['Notebook A5']!)))
  })

  test('create_row adds a row as the person looking, says Saved, and the page shows the new row', async ({ admin }) => {
    await shopItems(admin)
    await show(admin, definition(['add', 'plan'], [
      button('add', 'Add Gel Pen', 'create_row', { table: 'Shop Item', values: { item: 'Gel Pen', category: { '@path': '/state/category' } } }),
      table({ columns: [ITEM, { id: 'category', header: 'Category', value: { '@path': 'category' } }] }),
    ], { state: { category: 'Stationery' }, data: ITEM_ROWS }))
    await screen.findByRole('row', { name: /Notebook A5/ }, WAIT)
    fireEvent.click(screen.getByRole('button', { name: 'Add Gel Pen' }))
    expect(await screen.findByText('Saved', {}, WAIT)).toBeInTheDocument()
    expect(within(line('Gel Pen')).getByRole('cell')).toHaveTextContent('Stationery')
    expect((await admin.get<{ data: unknown[] }>(ITEMS.listUrl({ filters: [['item', '=', 'Gel Pen']] }))).data).toHaveLength(1)
  })

  const PLAN_INPUT: PagePart = { id: 'qty', component: 'Input', label: 'Planned quantity', kind: 'number', value: { '@path': 'planned_qty' } }
  const PLAN_SAVE = button('save', 'Save', 'save_row', { table: 'Shop Item', row: { '@path': 'row_id' }, updated_at: { '@path': 'updated_at' }, values: { planned_qty: { '@path': 'planned_qty' } } })
  const PLAN = definition(['plan'], [table({ columns: [ITEM, { id: 'plan', header: 'Plan', cell: 'cell' }] }), { id: 'cell', component: 'Row', children: ['qty', 'save'] }, PLAN_INPUT, PLAN_SAVE], { data: ITEM_ROWS })
  const typeAndSave = async (item: string, quantity: string) => {
    const row = await screen.findByRole('row', { name: new RegExp(item) }, WAIT)
    fireEvent.change(within(row).getByLabelText('Planned quantity'), { target: { value: quantity } })
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))
  }
  const boxes = () => screen.getAllByLabelText<HTMLInputElement>('Planned quantity').map((box) => box.value)

  test('saving one row keeps what was typed into another', async ({ admin }) => {
    const ids = await shopItems(admin)
    await show(admin, PLAN)
    fireEvent.change(within(await screen.findByRole('row', { name: /Salted Crisps/ }, WAIT)).getByLabelText('Planned quantity'), { target: { value: '320' } })
    await typeAndSave('Notebook A5', '700')
    expect(await screen.findByText('Saved', {}, WAIT)).toBeInTheDocument()
    expect(boxes()).toEqual(['700', '320'])
    expect((await admin.get<{ planned_qty: number | null }>(ITEMS.rowUrl(ids['Salted Crisps']!))).planned_qty).toBeNull()
  })

  test('a row saved twice on the same page is saved both times', async ({ admin }) => {
    const ids = await shopItems(admin)
    await show(admin, PLAN)
    await typeAndSave('Notebook A5', '700')
    await screen.findByText('Saved', {}, WAIT)
    await typeAndSave('Notebook A5', '720')
    await waitFor(async () => expect((await admin.get<{ planned_qty: number | null }>(ITEMS.rowUrl(ids['Notebook A5']!))).planned_qty).toBe(720), WAIT)
    await waitFor(() => expect(screen.getAllByText('Saved')).toHaveLength(2), WAIT)
  })

  const PLAN_SHOWN = definition(['plan'], [
    table({ columns: [ITEM, { id: 'planned', header: 'Planned', align: 'end', format: 'number', value: { '@path': 'planned_qty' } }, { id: 'plan', header: 'Plan', cell: 'cell' }] }),
    { id: 'cell', component: 'Row', children: ['qty', 'save'] }, PLAN_INPUT, PLAN_SAVE,
  ], { data: ITEM_ROWS })
  const savedCell = (item: string) => within(line(item)).getAllByRole('cell')[0]!.textContent

  test('a save refused because someone else changed the row shows their value, keeps what was typed, and goes through when made again', async ({ admin }) => {
    const ids = await shopItems(admin)
    await show(admin, PLAN_SHOWN)
    await screen.findByRole('row', { name: /Notebook A5/ }, WAIT)
    // Someone else plans 500 after this page read the row.
    const theirs = await admin.get<{ updated_at: string }>(ITEMS.rowUrl(ids['Notebook A5']!))
    await admin.fetch(ITEMS.rowUrl(ids['Notebook A5']!), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planned_qty: 500, updated_at: theirs.updated_at }) })
    await typeAndSave('Notebook A5', '700')
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent('has been modified after you loaded it')
    await waitFor(() => expect([savedCell('Notebook A5'), boxes()[0]]).toEqual(['500', '700']), WAIT)
    fireEvent.click(within(line('Notebook A5')).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved', {}, WAIT)).toBeInTheDocument()
    expect((await admin.get<{ planned_qty: number | null }>(ITEMS.rowUrl(ids['Notebook A5']!))).planned_qty).toBe(700)
    await waitFor(() => expect([savedCell('Notebook A5'), boxes()[0]]).toEqual(['700', '700']), WAIT)
  })

  test('a refusal that names columns says the server\'s message and then each column\'s', async ({ admin }) => {
    await shopItems(admin)
    await show(admin, PLAN_SHOWN)
    await typeAndSave('Notebook A5', '1.5')
    const refusal = await screen.findByRole('alert', {}, WAIT)
    expect([...refusal.querySelectorAll('p')].map((each) => each.textContent)).toEqual(['Invalid values for Shop Item', 'planned_qty: Expected integer, received float'])
  })

  test('while a save is on its way the button says it is busy', async ({ admin }) => {
    await shopItems(admin)
    await show(admin, PLAN)
    await screen.findByRole('row', { name: /Notebook A5/ }, WAIT)
    const slow = holdResponses(`${ITEMS.url}/`)
    await typeAndSave('Notebook A5', '700')
    await slow.asked
    expect(within(line('Notebook A5')).getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true')
    slow.release()
    await screen.findByText('Saved', {}, WAIT)
    expect(within(line('Notebook A5')).getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy')
  })

  test('a save the network drops says the server did not answer, and keeps what was typed', async ({ admin }) => {
    await shopItems(admin)
    await show(admin, PLAN)
    await screen.findByRole('row', { name: /Notebook A5/ }, WAIT)
    const bridge = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => (init?.method === 'PATCH' ? Promise.reject(new TypeError('Failed to fetch')) : bridge(input, init)))
    await typeAndSave('Notebook A5', '700')
    expect(await screen.findByRole('alert')).toHaveTextContent('The server didn’t answer. Try again in a moment.')
    expect(boxes()).toEqual(['700', ''])
  })
})

describe('what the page says about its rows', () => {
  const ROWS = definition(['intro', 'plan'], [text('intro'), table({ columns: [ITEM] })], { data: ITEM_ROWS })
  const open = (as: TestClient) => renderApp(pageHref(NAME), as)

  test('while rows are on their way the part that needs them shows the loading look, and the rest of the page is drawn', async ({ admin }) => {
    await shopItems(admin)
    await admin.post('/api/table/Page', { row_id: NAME, title: 'Shop Page', module: 'Shop', status: 'Published', definition: ROWS })
    const slow = holdResponses(ITEMS.url)
    await open(admin)
    await slow.asked
    expect(await screen.findByText('The intro line', {}, WAIT)).toBeInTheDocument()
    expect(within(screen.getByTestId('runtime-page')).getByRole('status')).toHaveTextContent('Loading rows')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    slow.release()
    expect(await screen.findByRole('row', { name: /Notebook A5/ }, WAIT)).toBeInTheDocument()
  })

  test('rows the network drops say the server did not answer, in the table\'s place', async ({ admin }) => {
    await shopItems(admin)
    const bridge = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => (String(input).startsWith(`${ITEMS.url}?`) ? Promise.reject(new TypeError('Failed to fetch')) : bridge(input, init)))
    await show(admin, ROWS)
    await waitFor(() => expect(within(screen.getByTestId('runtime-page')).getByRole('status')).toHaveTextContent('The server didn’t answer. Try again in a moment.'), WAIT)
    expect(screen.getByText('The intro line')).toBeInTheDocument()
  })

  test('a source with more rows than a page may read says how many it shows', async ({ admin }) => {
    await shopItems(admin)
    // 500 more items, written straight into the Table's storage inside this test's transaction.
    await sql.unsafe(`insert into featherbase.${tableName('Shop Item')} (row_id, item, category) select 'bulk-' || n, 'Pencil ' || n, 'Stationery' from generate_series(1, 500) n`)
    await show(admin, ROWS)
    await screen.findByRole('row', { name: /Notebook A5/ }, WAIT)
    expect(screen.getByTestId('page-header-status')).toHaveTextContent('Showing the first 500 of 502 rows of Shop Item.')
    expect(screen.getAllByRole('row')).toHaveLength(501)
  })

  test('a source that asks for fewer rows on purpose says nothing about the rest', async ({ admin }) => {
    await shopItems(admin)
    await show(admin, definition(['plan'], [table({ columns: [ITEM] })], { data: { lines: { ...ITEM_ROWS.lines, limit: 1 } } }))
    await screen.findByRole('row', { name: /Notebook A5/ }, WAIT)
    expect([screen.getAllByRole('row').length, screen.queryByTestId('page-header-status')]).toEqual([2, null])
  })

  test('a filter on the page\'s state reads the rows again when the state changes', async ({ admin }) => {
    await shopItems(admin)
    const category: PagePart = { id: 'category', component: 'Toggle', label: 'Category', value: { '@path': '/state/category' }, options: [{ value: 'Stationery', label: 'Stationery' }, { value: 'Snacks', label: 'Snacks' }] }
    await show(admin, definition(['category', 'plan'], [category, table({ columns: [ITEM] })], { state: { category: 'Stationery' }, data: { lines: { table: 'Shop Item', filters: [['category', '=', { '@path': '/state/category' }]] } } }))
    await screen.findByRole('row', { name: /Notebook A5/ }, WAIT)
    fireEvent.click(screen.getByRole('button', { name: 'Snacks' }))
    expect(await screen.findByRole('row', { name: /Salted Crisps/ }, WAIT)).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Notebook A5/ })).not.toBeInTheDocument()
  })
})

describe('a page that cannot be drawn', () => {
  test('a page the network drops says it could not be opened, and opens on Try again', async ({ admin }) => {
    await admin.post('/api/table/Page', { row_id: NAME, title: 'Shop Page', module: 'Shop', status: 'Published', definition: definition(['intro'], [text('intro')]) })
    const bridge = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => (String(input).startsWith('/api/pages/') ? Promise.reject(new TypeError('Failed to fetch')) : bridge(input, init)))
    await renderApp(pageHref(NAME), admin)
    expect(await screen.findByText('This page couldn’t be opened', {}, WAIT)).toBeInTheDocument()
    vi.restoreAllMocks()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('The intro line', {}, WAIT)).toBeInTheDocument()
  })

  test('while the page itself is on its way the page says it is loading', async ({ admin }) => {
    await admin.post('/api/table/Page', { row_id: NAME, title: 'Shop Page', module: 'Shop', status: 'Published', definition: definition(['intro'], [text('intro')]) })
    const slow = holdResponses('/api/pages/')
    await renderApp(pageHref(NAME), admin)
    await slow.asked
    expect(await screen.findByText('Loading page', {}, WAIT)).toBeInTheDocument()
    slow.release()
    expect(await screen.findByText('The intro line', {}, WAIT)).toBeInTheDocument()
  })

  test('a saved definition the catalog no longer allows is not drawn: the page names each mistake', async ({ admin }) => {
    await admin.post('/api/table/Page', { row_id: NAME, title: 'Shop Page', module: 'Shop', status: 'Published', definition: definition(['intro'], [text('intro')]) })
    // Saved before the catalog changed: written past the save's own check, as no API can.
    const stale = { version: '1.0', components: [{ id: 'root', component: 'Page', title: 'Shop Page', children: ['gone'] }, { id: 'spark', component: 'Sparkline' }] }
    await sql`update page set definition = ${sql.json(stale)} where row_id = ${NAME}`
    await renderApp(pageHref(NAME), admin)
    const notice = await screen.findByRole('alert', {}, WAIT)
    expect(notice).toHaveTextContent('This page cannot be drawn as it is saved.')
    expect(within(notice).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^components\.spark\.component: There is no part "Sparkline"\./),
      'components.root.children.0: There is no part with the id "gone"',
    ])
  })
})

describe('a group\'s Home page', () => {
  const home = async (admin: TestClient, group: string) => {
    const { pages } = await admin.get<{ pages: { row_id: string; module: string | null }[] }>('/api/home_pages')
    await renderApp(`/featherbase/admin/home/${encodeURIComponent(pages.find((page) => page.module === group)!.row_id)}`, admin)
    await screen.findByTestId('home-page-title', {}, WAIT)
  }
  const savePage = (admin: TestClient, status: 'Draft' | 'Published') =>
    admin.post('/api/table/Page', { row_id: NAME, title: 'Shop Page', module: 'Shop', status, definition: definition(['intro'], [text('intro')]) })

  test('a group with no pages has no Pages card', async ({ admin }) => {
    await shopItems(admin)
    await home(admin, 'Shop')
    expect([screen.getByTestId('home-link-Shop Item').textContent, screen.queryByTestId('home-card-pages')]).toEqual(['Shop Item', null])
  })

  test('a group that holds only a page lists it, and does not say nothing is here', async ({ admin }) => {
    await savePage(admin, 'Published')
    await home(admin, 'Shop')
    expect(within(screen.getByTestId('home-card-pages')).getByRole('link', { name: 'Shop Page' })).toHaveAttribute('href', pageHref(NAME))
    expect(screen.queryByTestId('home-page-empty')).not.toBeInTheDocument()
  })

  test('the Pages card comes before the group\'s Tables', async ({ admin }) => {
    await shopItems(admin)
    await savePage(admin, 'Published')
    await home(admin, 'Shop')
    expect([...screen.getByTestId('home-page-cards').children].map((card) => within(card as HTMLElement).getByTestId('home-card-heading').textContent)).toEqual(['Pages', 'Tables'])
  })

  test('a published page is not marked as a draft', async ({ admin }) => {
    await savePage(admin, 'Published')
    await home(admin, 'Shop')
    expect(within(screen.getByTestId('home-card-pages')).queryByText('Draft')).not.toBeInTheDocument()
  })

  test('a draft is marked with the shared chip', async ({ admin }) => {
    await savePage(admin, 'Draft')
    await home(admin, 'Shop')
    expect(within(screen.getByTestId('home-card-pages')).getByText('Draft')).toHaveAttribute('data-chip', 'amber')
  })
})

describe('a remembered page reads as its title, not its address', () => {
  // What the browser remembers of a visit to the page: its name, which is its address.
  const VISIT = { kind: 'page' as const, key: `page:page/${NAME}`, label: NAME, sub: 'Page', path: pageHref(NAME) }
  const savePage = (admin: TestClient) =>
    admin.post('/api/table/Page', { row_id: NAME, title: 'Shop Page', module: 'Shop', status: 'Published', definition: definition(['intro'], [text('intro')]) })

  test('in the sidebar\'s Recently Opened and on Home\'s Last view', async ({ admin }) => {
    await savePage(admin)
    recordAction('Administrator', VISIT, Date.now() - 1000)
    await renderApp('/featherbase/admin', admin)
    const tile = await screen.findByTestId('resume-tile-view')
    await waitFor(() => expect(within(tile).getByTestId('resume-tile-title')).toHaveTextContent(/^Shop Page$/), WAIT)
    const recent = await screen.findByTestId('sidebar-recent', {}, { timeout: 15_000 })
    await waitFor(() => expect(recent).toHaveTextContent('Shop Page'))
    expect([recent.textContent!.includes(NAME), recent.getAttribute('title')]).toEqual([false, expect.stringMatching(/^Shop Page · Page · opened /)])
  })

  test('in the activity trail', async ({ admin }) => {
    await savePage(admin)
    await admin.post('/api/events', { events: [{ ...VISIT, at: Date.now() - 2000 }] })
    await renderApp('/featherbase/admin', admin)
    const feed = await screen.findByTestId('activity-feed')
    expect(await within(feed).findByRole('button', { name: 'Shop Page' }, WAIT)).toBeInTheDocument()
    expect(feed).not.toHaveTextContent(NAME)
  })

  test('a page that is no longer there keeps the name it was remembered by', async ({ admin }) => {
    recordAction('Administrator', VISIT, Date.now() - 1000)
    await renderApp('/featherbase/admin', admin)
    expect(within(await screen.findByTestId('resume-tile-view')).getByTestId('resume-tile-title')).toHaveTextContent(NAME)
  })
})
