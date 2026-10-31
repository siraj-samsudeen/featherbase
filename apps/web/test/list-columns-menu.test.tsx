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
  expect(lines).toEqual(['Row ID', 'Section', 'Floor', 'Not in the list by default', 'Remarks', 'Notes'])
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
