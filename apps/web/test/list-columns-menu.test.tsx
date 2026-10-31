// #738 (list-columns-from-the-table): the "Show columns" menu offers every
// column the person may read — Row ID first and always on, the Table's list
// columns next, then "Not in the list by default" and the rest. Ticking one
// changes only that person's view, saved as { shownCols, hiddenCols } on top
// of the Table's list columns.
//
// Every test that switches a column waits for the settings PUT to land (see
// list-settings.test.tsx): a write that outlives the test's transaction
// would commit for real.

import { screen, waitFor, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

const DT = 'Lc Mapping'
const URL = `/api/user_settings/${encodeURIComponent(DT)}`

type Admin = Parameters<typeof renderApp>[1]
type Stored = { settings: { hiddenCols?: string[]; shownCols?: string[] } | null }

/** Section and Floor in the list; Remarks and Notes (restricted) not. */
async function seedTable(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'section', column_type: 'Data', label: 'Section', in_list_view: true },
      { column_name: 'floor', column_type: 'Data', label: 'Floor', in_list_view: true },
      { column_name: 'remarks', column_type: 'Data', label: 'Remarks' },
      { column_name: 'notes', column_type: 'Data', label: 'Notes', tier: 'restricted' },
    ],
  })
  await admin.post('/api/save_row', { table: DT, row: { section: 'Sarees', floor: 'Ground', remarks: 'Weekly', notes: 'Private' } })
}

async function openList(as: Admin) {
  await renderApp(`/featherbase/admin/${encodeURIComponent(DT)}`, as)
  await screen.findByTestId('list-view')
  await waitFor(() =>
    expect(within(screen.getByTestId('list-rows')).getByText('Sarees')).toBeInTheDocument(),
  )
}

async function openMenu() {
  screen.getByTestId('list-columns').click()
  return screen.findByTestId('list-columns-popup')
}

async function settledSettings(as: Admin, want: Record<string, unknown>) {
  await waitFor(async () => {
    const stored = (await as.get(URL)) as Stored
    expect(stored.settings).toMatchObject(want)
  })
}

const headers = () =>
  [...screen.getByTestId('list-view').querySelectorAll('thead [data-testid^="col-"]')].map((el) =>
    (el.textContent ?? '').replace(/[↑↓]/g, '').trim(),
  )

test('the menu lists Row ID, the list columns, then the rest under "Not in the list by default"', async ({ admin }) => {
  await seedTable(admin)
  await openList(admin)
  const menu = await openMenu()
  const lines = [...menu.children].map((el) => (el.textContent ?? '').trim())
  expect(lines).toEqual([
    'Row ID', 'Section', 'Floor', 'Not in the list by default', 'Remarks', 'Notes',
    // A System Manager's menu ends with the way to make this view everyone's.
    'Make this the default for everyone',
  ])
})

test('"Show columns" carries a chevron and reports its menu open and closed', async ({ admin }) => {
  await seedTable(admin)
  await openList(admin)
  const button = screen.getByTestId('list-columns')
  expect(button.querySelector('[data-chevron]')).not.toBeNull()
  expect(button).toHaveAttribute('aria-expanded', 'false')
  await openMenu()
  expect(button).toHaveAttribute('aria-expanded', 'true')
  button.click()
  await waitFor(() => expect(screen.queryByTestId('list-columns-popup')).toBeNull())
  expect(button).toHaveAttribute('aria-expanded', 'false')
})

test('the list columns start ticked and the rest unticked', async ({ admin }) => {
  await seedTable(admin)
  await openList(admin)
  const menu = await openMenu()
  const ticked = within(menu)
    .getAllByRole('checkbox')
    .map((box) => [(box.closest('label')?.textContent ?? '').trim(), (box as HTMLInputElement).checked])
  expect(ticked).toEqual([['Row ID', true], ['Section', true], ['Floor', true], ['Remarks', false], ['Notes', false]])
})

test('Row ID cannot be switched off', async ({ admin }) => {
  await seedTable(admin)
  await openList(admin)
  const menu = await openMenu()
  expect(within(menu).getByRole('checkbox', { name: 'Row ID' })).toBeDisabled()
})

test('switching on a column not in the list shows it, in the Table\'s column order', async ({ admin }) => {
  await seedTable(admin)
  await openList(admin)
  await openMenu()
  screen.getByTestId('list-col-toggle-remarks').click()
  await waitFor(() => expect(headers()).toEqual(['Row ID', 'Section', 'Floor', 'Remarks']))
  await settledSettings(admin, { shownCols: ['remarks'] })
})

test('the saved arrangement carries the columns switched on', async ({ admin }) => {
  await seedTable(admin)
  await openList(admin)
  await openMenu()
  screen.getByTestId('list-col-toggle-remarks').click()
  await settledSettings(admin, { shownCols: ['remarks'], hiddenCols: [] })
})

test('a fresh mount restores a column switched on', async ({ admin }) => {
  await seedTable(admin)
  await admin.put(URL, { sort: null, hiddenCols: [], shownCols: ['remarks'] })
  await openList(admin)
  await waitFor(() => expect(headers()).toEqual(['Row ID', 'Section', 'Floor', 'Remarks']))
})

test('an arrangement saved before shown columns existed still hides its column', async ({ admin }) => {
  await seedTable(admin)
  await admin.put(URL, { hiddenCols: ['floor'] })
  await openList(admin)
  await waitFor(() => expect(headers()).toEqual(['Row ID', 'Section']))
})

test('a reader of basic columns only is not offered a restricted column', async ({ admin, createUser }) => {
  await seedTable(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Lc Reader' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: 'Lc Reader', tier: 'basic', can_read: true } })
  const reader = await createUser({ email: 'lc.reader@example.com', roles: ['Lc Reader'] })
  await openList(reader)
  const menu = await openMenu()
  expect(within(menu).queryByRole('checkbox', { name: 'Notes' })).not.toBeInTheDocument()
})

// QA saw 3 rows for 2 once every column was off. Switching Row ID off used to
// drop row_id from the fetched fields, so rows came back without it, shared
// the React key "undefined", and a stale row survived the next fetch.
test('switching off every column leaves one row per row, each showing its ID', async ({ admin }) => {
  await seedTable(admin)
  await admin.post('/api/save_row', { table: DT, row: { section: 'Kids Wear', floor: 'First' } })
  await openList(admin)
  await openMenu()
  for (const name of ['row_id', 'section', 'floor']) {
    const box = screen.getByTestId(`list-col-toggle-${name}`) as HTMLInputElement
    if (box.checked && !box.disabled) {
      box.click()
      await waitFor(() => expect(screen.queryByTestId(`col-${name}`)).not.toBeInTheDocument())
    }
  }
  await settledSettings(admin, { hiddenCols: ['section', 'floor'] })
  const ids = (await admin.get<{ data: { row_id: string }[] }>(
    `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["row_id"]')}`,
  )).data.map((r) => r.row_id)
  await waitFor(() => {
    const rows = within(screen.getByTestId('list-rows')).getAllByRole('row')
    expect(rows.map((r) => r.textContent).sort()).toEqual([...ids].sort())
  })
})

// #738 (Decision 3): "Make this the default for everyone", at the foot of the
// menu, offered exactly where "Edit columns" is.
const MAKE_DEFAULT = 'Make this the default for everyone'
const metaUrl = `/api/table/${encodeURIComponent(DT)}:meta`
type Meta = { columns: { column_name: string; in_list_view?: boolean }[] }

test('a System Manager is offered "Make this the default for everyone" at the foot of the menu', async ({ admin }) => {
  await seedTable(admin)
  await openList(admin)
  const menu = await openMenu()
  expect(menu.lastElementChild).toHaveTextContent(MAKE_DEFAULT)
  expect(screen.getByTestId('open-columns')).toBeInTheDocument()
})

test('a reader who is not a System Manager is not offered it, nor "Edit columns"', async ({ admin, createUser }) => {
  await seedTable(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Lc Reader' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: 'Lc Reader', tier: 'basic', can_read: true } })
  const reader = await createUser({ email: 'lc.reader@example.com', roles: ['Lc Reader'] })
  await openList(reader)
  const menu = await openMenu()
  expect(within(menu).queryByRole('button', { name: MAKE_DEFAULT })).not.toBeInTheDocument()
  expect(screen.queryByTestId('open-columns')).not.toBeInTheDocument()
})

test('a Table whose columns belong to the platform offers neither', async ({ admin }) => {
  await renderApp('/featherbase/admin/Import%20Log', admin)
  await screen.findByTestId('list-view')
  const menu = await openMenu()
  expect(within(menu).queryByRole('button', { name: MAKE_DEFAULT })).not.toBeInTheDocument()
  expect(screen.queryByTestId('open-columns')).not.toBeInTheDocument()
})

async function makeDefaultFromView(admin: Admin) {
  await seedTable(admin)
  await openList(admin)
  await openMenu()
  screen.getByTestId('list-col-toggle-remarks').click()
  await settledSettings(admin, { shownCols: ['remarks'] })
  screen.getByTestId('list-col-toggle-floor').click()
  await settledSettings(admin, { hiddenCols: ['floor'] })
  within(screen.getByTestId('list-columns-popup')).getByRole('button', { name: MAKE_DEFAULT }).click()
}

test("making the default puts the System Manager's view in the Table's list", async ({ admin }) => {
  await makeDefaultFromView(admin)
  await waitFor(async () => {
    const meta = (await admin.get(metaUrl)) as Meta
    expect(Object.fromEntries(meta.columns.map((c) => [c.column_name, Boolean(c.in_list_view)]))).toEqual({
      section: true, floor: false, remarks: true, notes: false,
    })
  })
  await settledSettings(admin, { shownCols: [], hiddenCols: [] })
})

test("after making the default, the System Manager's own shown and hidden sets are empty", async ({ admin }) => {
  await makeDefaultFromView(admin)
  await settledSettings(admin, { shownCols: [], hiddenCols: [] })
  await waitFor(() => expect(headers()).toEqual(['Row ID', 'Section', 'Remarks']))
})
