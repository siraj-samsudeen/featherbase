// #738 (list-columns-from-the-table): the "Show columns" menu offers every
// column the person may read — Row ID first and always on, the Table's list
// columns next, then "Not in the list by default" and the rest. Ticking one
// changes only that person's view, saved as { shownCols, hiddenCols } on top
// of the Table's list columns.
//
// Every test that switches a column waits for the settings PUT to land (see
// list-settings.test.tsx): a write that outlives the test's transaction
// would commit for real.

import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { issueSession } from 'server/src/auth'
import { setSession } from '../src/lib/api'
import { grantRole } from 'server/test/fixtures'
import { openListMenu, hasListMenu } from './list-menus'

const DT = 'Lc Mapping'
const URL = `/api/user_settings/${encodeURIComponent(DT)}`

type Admin = Parameters<typeof renderApp>[1]
type Stored = { settings: { hiddenCols?: string[]; shownCols?: string[] } | null }

/** Section and Floor in the list; Remarks and Notes (restricted) not. */
async function seedTable(admin: Admin) {
  await admin.post('/api/table_def', { row_rule: { kind: 'all' },
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
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}`, as)
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
  await grantRole(admin, { table: DT, role: 'Lc Reader', tier: 'basic', can_read: true })
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
// #1282 A4 (UI owner): the Table's default is the whole view, made from the View menu (no longer this menu's foot).
const MAKE_DEFAULT = "Make This the Table's Default…"
const defaultUrl = `/api/table_view_default/${encodeURIComponent(DT)}`
type Default = { default: { settings: { shownCols?: string[]; hiddenCols?: string[] } } | null }

test('the Columns menu offers no default; a System Manager finds it in the View menu', async ({ admin }) => {
  await seedTable(admin)
  await openList(admin)
  const menu = await openMenu()
  expect(within(menu).queryByRole('button', { name: /default/i })).not.toBeInTheDocument()
  expect((await openListMenu('View')).getByRole('button', { name: MAKE_DEFAULT })).toBeInTheDocument()
  await openListMenu('Table administration')
  expect(screen.getByTestId('open-columns')).toBeInTheDocument()
})

test('a reader who is not a System Manager is not offered it, nor "Edit columns"', async ({ admin, createUser }) => {
  await seedTable(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Lc Reader' } })
  await grantRole(admin, { table: DT, role: 'Lc Reader', tier: 'basic', can_read: true })
  const reader = await createUser({ email: 'lc.reader@example.com', roles: ['Lc Reader'] })
  await openList(reader)
  expect((await openListMenu('View')).queryByRole('button', { name: MAKE_DEFAULT })).not.toBeInTheDocument()
  expect(await hasListMenu('Table administration')).toBe(false)
  expect(screen.queryByTestId('open-columns')).not.toBeInTheDocument()
})

test('a Table whose columns belong to the platform offers neither', async ({ admin }) => {
  await renderApp('/featherbase/admin/table/import-log', admin)
  await screen.findByTestId('list-view')
  expect((await openListMenu('View')).queryByRole('button', { name: MAKE_DEFAULT })).not.toBeInTheDocument()
  await openListMenu('Table administration')
  expect(screen.queryByTestId('open-columns')).not.toBeInTheDocument()
})

async function confirmDefaultFromView(admin: Admin) {
  await seedTable(admin)
  await openList(admin)
  await openMenu()
  screen.getByTestId('list-col-toggle-remarks').click()
  await settledSettings(admin, { shownCols: ['remarks'] })
  screen.getByTestId('list-col-toggle-floor').click()
  await settledSettings(admin, { hiddenCols: ['floor'] })
  await userEvent.click((await openListMenu('View')).getByRole('button', { name: MAKE_DEFAULT }))
  return screen.findByTestId('table-default-dialog')
}

test('the confirm names each setting in words before anything is saved', async ({ admin }) => {
  const dialog = await confirmDefaultFromView(admin)
  expect([...within(dialog).getByTestId('table-default-words').children].map((li) => li.textContent))
    .toEqual(['Table With Panel', 'Show Columns: Row ID, Section, Remarks', 'Sorted as the Table is', 'Compact Rows: Off', 'Show Links As: Sections', 'Fields Beside Links: Show'])
  expect(dialog).toHaveTextContent("People who've changed these keep their own choices.")
  expect((await admin.get(defaultUrl) as Default).default).toBeNull()
  await userEvent.click(within(dialog).getByTestId('table-default-cancel'))
  expect(screen.queryByTestId('table-default-dialog')).not.toBeInTheDocument()
})

test("making the default saves the System Manager's view, and the toast's Undo puts the earlier one back", async ({ admin }) => {
  const dialog = await confirmDefaultFromView(admin)
  await userEvent.click(within(dialog).getByTestId('table-default-confirm'))
  await waitFor(async () => expect((await admin.get(defaultUrl) as Default).default?.settings).toMatchObject({ shownCols: ['remarks'], hiddenCols: ['floor'] }))
  expect(await screen.findByTestId('table-default-toast')).toHaveTextContent("Saved as the Table's default · Undo")
  await userEvent.click(screen.getByTestId('table-default-undo'))
  await waitFor(async () => expect((await admin.get(defaultUrl) as Default).default).toBeNull())
  await waitFor(() => expect(screen.getByTestId('table-default-toast')).toHaveTextContent('Put the earlier default back.'))
})

test('a refused default save says so and changes nothing', async ({ admin }) => {
  const dialog = await confirmDefaultFromView(admin)
  const expired = await issueSession('Administrator')
  expect((await fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${expired.token}` } })).status).toBe(200)
  setSession(expired.token, { row_id: 'Administrator', email: null, full_name: null })
  await userEvent.click(within(dialog).getByTestId('table-default-confirm'))
  expect(await screen.findByTestId('table-default-error')).toHaveTextContent(`Couldn't save the default. ${DT} opens as it did.`)
  expect((await admin.get(defaultUrl) as Default).default).toBeNull()
  await settledSettings(admin, { shownCols: ['remarks'] })
})
