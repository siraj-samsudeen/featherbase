// #905: a System Manager archives a custom Table from its list. A banner says
// who, when and what replaced it; nobody can add rows; it moves to Archived
// tables and out of the table pickers; Un-archive brings it all back.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { holdResponses } from './held-requests'
import { canArchive } from '../src/components/ArchiveTable'
import type { TableMeta } from '../src/lib/meta'

type Admin = Parameters<typeof renderApp>[1]
const OLD = 'Twa SAP Plant'

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: OLD, columns: [{ column_name: 'city', column_type: 'Data', label: 'City' }] })
  await admin.post('/api/save_row', { table: OLD, row: { city: 'Chennai' } })
}

test('archiving from the list shows the banner, takes away New, and un-archive brings it back', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp('/featherbase/admin/table/twa-sap-plant', admin)
  expect(await screen.findByTestId('list-new', undefined, { timeout: 10_000 })).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Table administration' }))
  await user.click(await screen.findByTestId('archive-table'))
  const dialog = await screen.findByTestId('archive-table-dialog')
  expect(dialog).toHaveTextContent(`Archive ${OLD}?`)
  await user.type(within(dialog).getByTestId('archive-table-note'), 'Replaced by Plant')
  await user.click(within(dialog).getByTestId('archive-table-confirm'))

  const banner = await screen.findByTestId('archived-banner', undefined, { timeout: 10_000 })
  expect(banner).toHaveTextContent(`${OLD} is archived.`)
  expect(within(banner).getByTestId('archived-note')).toHaveTextContent('Replaced by Plant')
  await waitFor(() => expect(within(banner).getByTestId('principal-name')).not.toHaveTextContent('…'))
  expect(screen.queryByTestId('archive-table-dialog')).not.toBeInTheDocument()
  // The rows stay; nothing adds or changes one.
  expect(await screen.findByText('Chennai')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('list-new')).not.toBeInTheDocument())

  await user.click(within(banner).getByTestId('unarchive-table'))
  await waitFor(() => expect(screen.queryByTestId('archived-banner')).not.toBeInTheDocument(), { timeout: 10_000 })
  expect(await screen.findByTestId('list-new')).toBeInTheDocument()
})

test('an archived Table is listed under Archived tables, once', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', { name: 'Twa Visit', columns: [{ column_name: 'plant', column_type: 'Data', label: 'Plant' }] })
  await admin.post('/api/table_def/Twa%20SAP%20Plant/archive', { note: 'Replaced by Plant' })

  await renderApp('/featherbase/admin/all-tables', admin)
  const group = await screen.findByTestId('archived-group', undefined, { timeout: 10_000 })
  expect(within(group).getByRole('link', { name: OLD })).toBeInTheDocument()
  const nav = screen.getByTestId('table-nav')
  expect(within(nav).getAllByRole('link', { name: OLD })).toHaveLength(1)
})

test('no table picker offers an archived Table', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', { name: 'Twa Visit', columns: [{ column_name: 'plant', column_type: 'Data', label: 'Plant' }] })
  await admin.post('/api/table_def/Twa%20SAP%20Plant/archive', { note: 'Replaced by Plant' })
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/twa-visit/columns', admin)
  await user.click(await screen.findByRole('button', { name: 'Turn plant into a link' }, { timeout: 10_000 }))
  const picker = await screen.findByRole('combobox', { name: 'Table plant links to' })
  await waitFor(() => expect(within(picker).getAllByRole('option').length).toBeGreaterThan(2))
  const options = within(picker).getAllByRole('option').map((o) => o.textContent)
  expect(options).toContain('Twa Visit')
  expect(options).not.toContain(OLD)
})

test('a row of an archived Table opens read only, with the banner', async ({ admin }) => {
  await seed(admin)
  const { data } = await admin.get<{ data: { row_id: string }[] }>(`/api/table/${encodeURIComponent(OLD)}`)
  await admin.post('/api/table_def/Twa%20SAP%20Plant/archive', {})
  await renderApp(`/featherbase/admin/table/twa-sap-plant/row/${encodeURIComponent(data[0].row_id)}`, admin)
  const form = await screen.findByTestId('form-view', undefined, { timeout: 10_000 })
  expect(await within(form).findByTestId('archived-banner')).toHaveTextContent(`${OLD} is archived.`)
  expect(within(form).queryByTestId('form-save')).not.toBeInTheDocument()
  expect(within(form).queryByTestId('unarchive-table')).not.toBeInTheDocument()
})

test('#1041: a refusal shows in the dialog, and clicking inside the dialog leaves it open', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Twa Roster', decides_scope: true, columns: [{ column_name: 'city', column_type: 'Data' }] })
  await renderApp('/featherbase/admin/table/twa-roster', admin)
  await user.click(await screen.findByRole('button', { name: 'Table administration' }, { timeout: 10_000 }))
  await user.click(await screen.findByTestId('archive-table'))
  const dialog = await screen.findByTestId('archive-table-dialog')
  await user.type(within(dialog).getByTestId('archive-table-note'), 'Not in use')

  // Blank space takes focus off the note; the dialog and the typed note stay.
  await user.click(within(dialog).getByRole('heading'))
  expect(screen.getByTestId('archive-table-note')).toHaveValue('Not in use')

  await user.click(screen.getByTestId('archive-table-confirm'))
  expect(await screen.findByTestId('archive-table-error')).toHaveTextContent('it decides who can see or do what')
  expect(screen.getByTestId('archive-table-dialog')).toBeInTheDocument()
})

test("#1041: an app's table offers Archive; the platform's, a settings table and a sub-table don't", () => {
  const table = { name: 'dash.store_floor', kind: 'table', owner_app: 'dash' } as TableMeta
  expect(canArchive(table)).toBe(true)
  expect(canArchive({ ...table, system: true })).toBe(false)
  expect(canArchive({ ...table, system_written: true })).toBe(false)
  expect(canArchive({ ...table, kind: 'settings' } as TableMeta)).toBe(false)
  expect(canArchive({ ...table, kind: 'sub_table' } as TableMeta)).toBe(false)
})

async function openArchive(admin: Admin) {
  await seed(admin)
  await renderApp('/featherbase/admin/table/twa-sap-plant', admin)
  await userEvent.click(await screen.findByRole('button', { name: 'Table administration' }, { timeout: 10_000 }))
  await userEvent.click(await screen.findByTestId('archive-table'))
  return screen.findByTestId('archive-table-dialog')
}

test('Cancel closes the Archive dialog, archiving nothing', async ({ admin }) => {
  const dialog = await openArchive(admin)
  await userEvent.click(within(dialog).getByTestId('archive-table-cancel'))
  expect(screen.queryByTestId('archive-table-dialog')).not.toBeInTheDocument()
  expect(screen.queryByTestId('archived-banner')).not.toBeInTheDocument()
})

test('a click outside the Archive dialog while it archives keeps it open', async ({ admin }) => {
  const dialog = await openArchive(admin)
  const archiving = holdResponses('/archive')
  await userEvent.click(within(dialog).getByTestId('archive-table-confirm'))
  await archiving.asked
  await userEvent.click(dialog.parentElement!)
  expect(screen.getByTestId('archive-table-dialog')).toBeInTheDocument()
  await act(async () => { archiving.release() })
  expect(await screen.findByTestId('archived-banner', undefined, { timeout: 10_000 })).toBeInTheDocument()
})

test('an Un-archive the server refuses says why on the banner', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def/Twa%20SAP%20Plant/archive', { note: 'Replaced by Plant' })
  await renderApp('/featherbase/admin/table/twa-sap-plant', admin)
  const banner = await screen.findByTestId('archived-banner', undefined, { timeout: 10_000 })
  // Un-archived meanwhile, from elsewhere.
  await admin.post('/api/table_def/Twa%20SAP%20Plant/unarchive', {})
  await userEvent.click(within(banner).getByTestId('unarchive-table'))
  expect(await within(banner).findByText(/not archived/i, undefined, { timeout: 10_000 })).toBeInTheDocument()
})
