// Admin feedback and accessible controls, moved down from
// e2e/ui-feedback.spec.ts (#1080): the real Admin in jsdom against the
// in-process server. Where the e2e stubbed the server's answers, these tests
// use real ones: a refused form save comes from a check constraint added
// inside the sandbox (rolled back with it), and the source preview reads a
// real external Postgres with the foreign keys the e2e described.
import { tableSlug } from 'shared'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import postgres from 'postgres'
import { afterAll, beforeAll, vi } from 'vitest'
import { sql } from 'server/src/db'
import { invalidateSources } from 'server/src/sources/registry'
import { quoteRelation, tableRelation } from 'server/src/table-engine'
import { EXTERNAL_DATABASE_URL } from 'server/test/external-database'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const here = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname

test('Table collision describes four destinations without changing Enter precedence', async ({ admin }) => {
  const app = await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('all-tables-link', {}, { timeout: 8000 })
  const bar = screen.getByLabelText('Search or type a command')
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Table' } })
  for (const kind of ['commands', 'tables', 'create', 'records'])
    expect(await screen.findByTestId(`awesomebar-${kind}-heading`, {}, { timeout: 8000 })).toBeInTheDocument()
  expect(screen.getByTestId('awesomebar-cmd-new-table').textContent).toBe('› New Table')
  expect(screen.getAllByTestId('awesomebar-table').filter((e) => /^TableCore module/.test(e.textContent ?? ''))).toHaveLength(1)
  expect(screen.getAllByTestId('awesomebar-new').filter((e) => e.textContent?.includes('New Table row'))).toHaveLength(1)
  expect(screen.getAllByTestId('awesomebar-doc').filter((e) => /Table definition/.test(e.textContent ?? '')).length).toBeGreaterThan(0)

  fireEvent.submit(bar.closest('form') as HTMLFormElement)
  await waitFor(() => expect(here(app)).toBe('/featherbase/admin/table/table'))
  expect(await screen.findByTestId('list-view')).toBeInTheDocument()
})

function workbook(names: string[]) {
  const wb = XLSX.utils.book_new()
  for (const [i, name] of names.entries())
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Count'], [name, i + 7]]), name)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], 'zones.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

test('multi-sheet warning names omissions next to the drop and disappears on replacement or clear', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/new-table', admin)
  const input = await screen.findByTestId('dt-file-input', {}, { timeout: 8000 })
  fireEvent.change(input, { target: { files: [workbook(['Zones', 'Stores', 'Prices'])] } })
  const warning = await screen.findByTestId('dt-more-sheets', {}, { timeout: 8000 })
  expect(warning.textContent).toBe('Only “Zones” will be imported. Ignored sheets: “Stores”, “Prices”. Use the Import wizard to import all 3 sheets.')
  expect(warning).toHaveAttribute('role', 'status')
  expect(screen.getByTestId('dt-dropzone').nextElementSibling).toBe(warning)
  await waitFor(() => expect(screen.getByTestId('dt-preview')).toHaveTextContent('Zones'))
  expect(screen.getByTestId('dt-preview')).not.toHaveTextContent('Stores')
  expect(within(warning).getByRole('link', { name: 'Import wizard' }).getAttribute('href')).toMatch(/\/admin\/import/)

  fireEvent.change(input, { target: { files: [workbook(['Solo'])] } })
  await waitFor(() => expect(screen.queryByTestId('dt-more-sheets')).not.toBeInTheDocument())
  fireEvent.change(input, { target: { files: [workbook(['North', 'South'])] } })
  await waitFor(() => expect(screen.getByTestId('dt-more-sheets')).toHaveTextContent('“South”'))
  expect(screen.getByTestId('dt-more-sheets')).not.toHaveTextContent('Stores')
  await user.click(screen.getByTestId('dt-clear-file'))
  expect(screen.queryByTestId('dt-more-sheets')).not.toBeInTheDocument()
})

test('a rejected latest theme choice returns the rendered choice to the confirmed one', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/new-table', admin)
  await user.click(await screen.findByTestId('theme-dark', {}, { timeout: 8000 }))
  await waitFor(async () => expect((await admin.get<{ theme: string }>('/api/whoami')).theme).toBe('dark'))

  // The next choice is refused with the server's error shape. Refused at the
  // network edge: set_theme is one plain UPDATE outside any transaction, so a
  // real refusal inside the sandbox would abort the test's own transaction.
  let refused = 0
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).endsWith('/api/set_theme')) {
      refused++
      return Response.json({ error: { type: 'TestFailure', message: 'Preference refused' } }, { status: 500 })
    }
    return real(input, init)
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await user.click(screen.getByTestId('theme-light'))
  await waitFor(() => expect(refused).toBe(1))
  await waitFor(() => expect(screen.getByTestId('theme-dark')).toHaveAttribute('aria-checked', 'true'))
  expect(screen.getByTestId('theme-light')).toHaveAttribute('aria-checked', 'false')
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  expect((await admin.get<{ theme: string }>('/api/whoami')).theme).toBe('dark')
})

async function formFixture(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Uif Row',
    kind: 'sub_table',
    columns: [
      { column_name: 'item', column_type: 'Data', label: 'Item' },
      { column_name: 'qty', column_type: 'Int', label: 'Qty' },
    ],
  })
  await admin.post('/api/table_def', {
    name: 'Uif Form',
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', reqd: true },
      { column_name: 'done', column_type: 'Check', label: 'Done' },
      { column_name: 'stage', column_type: 'Choice', label: 'Status', choices: 'Open\nClosed' },
      { column_name: 'items', column_type: 'Sub-table', label: 'Items', row_table: 'Uif Row' },
    ],
  })
  return admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Uif Form',
    row: { title: 'form fixture', done: true, stage: 'Open', items: [{ item: 'bolt', qty: 2 }, { item: 'nut', qty: 6 }] },
  })
}

test('generated controls are reachable by labels, including child rows and error/saved states', async ({ admin }) => {
  const user = userEvent.setup()
  const row = await formFixture(admin)
  await renderApp(`/featherbase/admin/table/${tableSlug('Uif Form')}/row/${row.row_id}`, admin)
  const title = await waitFor(() => {
    const el = screen.getByLabelText('Title') as HTMLInputElement
    expect(el).toHaveValue('form fixture')
    return el
  }, { timeout: 8000 })
  expect(screen.getByLabelText('Done')).toBeChecked()
  expect(screen.getByLabelText('Status')).toHaveValue('Open')
  expect(await screen.findByLabelText('Items, Item, row 2')).toHaveValue('nut')

  fireEvent.change(title, { target: { value: 'Accessible form' } })
  await user.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner').textContent).toBe('Saved'))

  // The database now refuses this title, so the next save fails at the server.
  const rel = quoteRelation(await tableRelation('Uif Form'))
  await sql.unsafe(`alter table ${rel} add constraint ui_feedback_refused check (title is distinct from 'Unsaved correction')`)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unsaved correction' } })
  await user.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner').textContent).not.toBe('Saved'))
  expect(screen.getByTestId('form-banner')).toHaveTextContent('Internal server error')
  expect(screen.getByTestId('form-status')).toHaveTextContent('Not saved')
  expect(screen.getByLabelText('Title')).toHaveValue('Unsaved correction')
  expect((await admin.get<{ title: string }>(`/api/table/${encodeURIComponent('Uif Form')}/${row.row_id}`)).title).toBe('Accessible form')
})

test('visible attachment actions identify their fields and keyboard activation opens the correct chooser', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', {
    name: 'Accessible Attachments',
    columns: [
      { column_name: 'invoice', column_type: 'Attach', label: 'Invoice' },
      { column_name: 'receipt', column_type: 'Attach', label: 'Receipt' },
      { column_name: 'photo', column_type: 'Attach Image', label: 'Photo' },
    ],
  })
  await renderApp('/featherbase/admin/table/accessible-attachments/new', admin)
  for (const [field, label, kind, key] of [
    ['invoice', 'Invoice', 'file', '{Enter}'],
    ['receipt', 'Receipt', 'file', ' '],
    ['photo', 'Photo', 'image', '{Enter}'],
  ] as const) {
    const action = await screen.findByRole('button', { name: `Attach ${kind} — ${label}` }, { timeout: 8000 })
    const input = document.querySelector<HTMLInputElement>(`[data-attach-input=${field}]`)!
    expect(input.getAttribute('accept')).toBe(kind === 'image' ? 'image/*' : null)
    // The chooser a browser opens is the input's own click; count where it lands.
    const opened: string[] = []
    const listen = (e: Event) => opened.push((e.target as HTMLElement).getAttribute('data-attach-input') ?? '')
    document.addEventListener('click', listen, true)
    try {
      action.focus()
      expect(action).toHaveFocus()
      await user.keyboard(key)
    } finally {
      document.removeEventListener('click', listen, true)
    }
    expect(opened.filter(Boolean)).toEqual([field])
  }
})

test('persisted child controls retain actual nodes and IDs across edit, reorder and removal', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', {
    name: 'Identity Line', kind: 'sub_table',
    columns: [{ column_name: 'item', column_type: 'Data', label: 'Item' }],
  })
  await admin.post('/api/table_def', {
    name: 'Identity Form',
    columns: ['items', 'extras'].map((name) => ({ column_name: name, column_type: 'Sub-table', label: name, row_table: 'Identity Line' })),
  })
  const saved = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Identity Form', row: { items: [{ item: 'bolt' }, { item: 'nut' }], extras: [{ item: 'washer' }] },
  })
  await renderApp(`/featherbase/admin/table/identity-form/row/${encodeURIComponent(saved.row_id)}`, admin)
  const nut = await waitFor(() => {
    const el = screen.getByLabelText('items, Item, row 2') as HTMLInputElement
    expect(el).toHaveValue('nut')
    return el
  }, { timeout: 8000 })
  const originalId = nut.id
  const extraId = screen.getByLabelText('extras, Item, row 1').id
  fireEvent.change(nut, { target: { value: 'nut edited' } })
  const grid = within(screen.getByRole('group', { name: 'items' }))
  await user.click(grid.getAllByRole('button', { name: 'Move row up' })[1])
  expect(screen.getByLabelText('items, Item, row 1')).toHaveValue('nut edited')
  expect(nut.isConnected && nut.id === originalId && document.getElementById(originalId) === nut).toBe(true)
  await user.click(grid.getAllByRole('button', { name: 'Remove row' })[1])
  expect(nut.isConnected && nut.id === originalId && document.getElementById(originalId) === nut).toBe(true)
  expect(nut.getAttribute('aria-label')).toBe('items, Item, row 1')
  await user.click(screen.getByTestId('add-row-items'))
  fireEvent.change(await screen.findByLabelText('items, Item, row 2'), { target: { value: 'replacement' } })
  expect(screen.getByLabelText('extras, Item, row 1').id).toBe(extraId)
  const ids = [...document.querySelectorAll<HTMLElement>('[data-childfield]')].map((el) => el.id)
  expect(new Set(ids).size).toBe(ids.length)
})

// The external database the source preview reads: orders with a foreign key
// of each kind the preview must tell apart.
const ENV = 'WEB_UIF_SOURCE_URL'
let external: ReturnType<typeof postgres>
beforeAll(async () => {
  process.env[ENV] = EXTERNAL_DATABASE_URL
  external = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
  await external.unsafe('drop schema if exists uif cascade; drop schema if exists uif_archive cascade')
  await external.unsafe(`create schema uif; create schema uif_archive;
    create table uif.customers (id integer primary key, code text unique, count integer);
    create table uif_archive.customers (id integer primary key, count integer);
    create table uif.warehouses (id integer primary key, count integer);
    create table uif.legacy (id integer primary key, code text unique, count integer);
    create table uif.orders (
      id integer primary key,
      customer_id integer references uif.customers (id),
      archive_id integer references uif_archive.customers (id),
      code text references uif.customers (code),
      warehouse_id integer references uif.warehouses (id),
      legacy_id integer references uif.legacy (id),
      amount integer);`)
})
afterAll(async () => {
  invalidateSources()
  await external.unsafe('drop schema if exists uif cascade; drop schema if exists uif_archive cascade')
  await external.end({ timeout: 2 })
})

test('source preview distinguishes bound, selected, wrong-schema and wrong-key FK proposals', async ({ admin }) => {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', { row_id: 'uif-preview', engine: 'postgres', url_env: ENV, access: 'read_only' })
  const bind = (name: string, table: string, pk: string) => admin.post('/api/table_def', {
    name, data_source: 'uif-preview', external_schema: 'uif', external_table: table, external_pk: pk,
    columns: [{ column_name: 'count', column_type: 'Int', source_column: 'count' }],
  })
  await bind('Warehouse', 'warehouses', 'id')
  // Legacy is bound twice. A reference follows the earliest binding, keyed on
  // `code`, so legacy_id (a key on `id`) is no reference; the table reads as
  // already connected under its latest name.
  await bind('Aaa Legacy Old', 'legacy', 'code')
  await bind('Legacy Latest', 'legacy', 'id')

  let writes = 0
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).includes(':reflect')) writes++
    return real(input, init)
  })
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/source/uif-preview', admin)
  await user.click(await screen.findByTestId('sb-load', {}, { timeout: 8000 }))
  const orders = await screen.findByTestId('sb-row-orders', {}, { timeout: 10_000 })
  await user.click(orders.querySelector('summary')!)
  const preview = screen.getByRole('list', { name: 'Columns of uif.orders' })
  const field = (name: string) => within(preview).getAllByRole('listitem')
    .find((li) => li.querySelector('span.font-mono')?.textContent === name)!

  expect(field('warehouse_id')).toHaveTextContent('Reference → Warehouse')
  expect(field('customer_id')).toHaveTextContent('Reference requires')
  await user.click(screen.getByLabelText('Reflect uif.customers'))
  expect(field('customer_id')).toHaveTextContent('Reference → Uif Customers')
  expect(field('archive_id')).not.toHaveTextContent('Reference →')
  expect(field('archive_id')).toHaveTextContent('uif_archive.customers.id')
  expect(field('code')).not.toHaveTextContent('Reference →')
  expect(field('code')).toHaveTextContent('uif.customers.code')
  expect(field('legacy_id')).not.toHaveTextContent('Reference →')
  expect(within(screen.getByTestId('sb-row-legacy')).getByRole('link', { name: 'Legacy Latest' })).toBeInTheDocument()
  expect(field('amount').textContent).toBe('amount (integer) → Int')
  expect(field('id')).toHaveTextContent('Row ID')
  await user.click(screen.getByLabelText('Reflect uif.customers'))
  expect(field('customer_id')).not.toHaveTextContent('Reference →')
  expect(writes).toBe(0)

  // The source stops answering: the next load says so, and the stale preview goes.
  process.env[ENV] = 'postgres://nobody:nothing@127.0.0.1:1/none'
  invalidateSources()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await user.click(screen.getByTestId('sb-load'))
    const failure = await waitFor(() => {
      const shown = screen.getByTestId('source-browser').querySelector('p.text-negative')
      expect(shown).toBeInstanceOf(HTMLElement)
      return shown!
    }, { timeout: 30_000 })
    expect(failure).toHaveTextContent('Data source uif-preview failed')
    expect(screen.queryByRole('list', { name: 'Columns of uif.orders' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('sb-row-orders')).not.toBeInTheDocument()
  } finally {
    process.env[ENV] = EXTERNAL_DATABASE_URL
    invalidateSources()
  }
}, 60_000)
