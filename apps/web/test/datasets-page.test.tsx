// #1409 (issue points 16 to 24): the Datasets page. Every installed app's
// datasets, where each is served from, its rows and how fresh they are, with
// Switch To Warehouse beside each stand-in. The real Admin against the
// in-process server; the app is the Store Sales fixture and its warehouse is
// made-up rows.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { buildSnapshot } from 'server/src/dataset-snapshot'
import { grantRole } from 'server/test/fixtures'
import { TARGETS, WAREHOUSE_TARGETS, loadTargets, storeSales, useWarehouse, warehouseTargets } from 'server/test/stand-in-fixture'
import { fmtDayIST, rowHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { holdResponses } from './held-requests'

useWarehouse()

const PAGE = '/featherbase/admin/datasets'
const T = { timeout: 10_000 }
const INSTANT = /^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2} IST$/
type Listed = { apps: { datasets: { name: string; snapshot: string | null }[] }[] }
/** The snapshot a dataset is served from, as the server lists it. */
const snapshotOf = async (admin: TestClient, dataset: string) =>
  (await admin.get<Listed>('/api/datasets')).apps[0].datasets.find((each) => each.name === dataset)!.snapshot
const today = () => fmtDayIST(new Date())
const entry = (dataset: string) => screen.findByTestId(`dataset-storesales.${dataset}`, {}, T)
/** A row's cells in column order: Dataset (the row's header), Served From, Rows, As Of, the action. */
const cells = (row: HTMLElement) => [within(row).getByRole('rowheader'), ...within(row).getAllByRole('cell')]

/** Store Sales with `sales` from the warehouse and `targets` a stand-in. */
async function standingIn(admin: TestClient, createUser: CreateUserFn) {
  await storeSales(admin, createUser)
  expect(await buildSnapshot('storesales.sales')).toMatchObject({ status: 'activated' })
  await loadTargets(admin, { note: 'From the planning workbook', expected_by: '2026-12-15' })
}

test('the sidebar group "This instance" opens Datasets, headed with what the page is for (point 16)', async ({ admin, createUser }) => {
  await standingIn(admin, createUser)
  await renderApp('/featherbase/admin', admin)
  const link = await screen.findByTestId('datasets-link', {}, T)
  expect(within(screen.getByTestId('sidebar-group-instance')).getByRole('link', { name: 'Datasets' })).toBe(link)
  expect(link).toHaveAttribute('href', PAGE)
  await userEvent.click(link)
  expect(await screen.findByRole('heading', { level: 1, name: 'Datasets' }, T)).toBeInTheDocument()
  expect(screen.getByText('Where each app’s data comes from. A stand-in is sample data loaded from a file, shown until the warehouse has the real data.')).toBeInTheDocument()
  expect(await entry('targets')).toBeInTheDocument()
})

test('someone without the System Manager role has no Datasets link and is sent to the Admin home (point 16)', async ({ admin, createUser }) => {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Shelf Clerk' } })
  await admin.post('/api/table_def', { name: 'Shelf Note', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  await grantRole(admin, { table: 'Shelf Note', role: 'Shelf Clerk', can_read: true })
  const clerk = await createUser({ email: 'clerk.datasets@example.test', roles: ['Shelf Clerk'] })
  await renderApp(PAGE, clerk)
  await screen.findByTestId('all-tables-link', {}, T)
  expect(screen.queryByTestId('datasets-page')).not.toBeInTheDocument()
  expect(screen.queryByTestId('datasets-link')).not.toBeInTheDocument()
})

test('each app that declares a dataset has a section, with one row per dataset (points 17 to 20, 23, 24)', async ({ admin, createUser }) => {
  await standingIn(admin, createUser)
  await renderApp(PAGE, admin)

  const section = await screen.findByRole('region', { name: 'Store Sales datasets' }, T)
  expect(screen.getByRole('heading', { level: 2, name: 'Store Sales' })).toBeInTheDocument()
  expect(within(section).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Dataset', 'Served From', 'Rows', 'As Of', 'Switch To Warehouse'])
  expect(within(section).getAllByTestId(/^dataset-storesales\./).map((row) => row.getAttribute('data-testid'))).toEqual(['dataset-storesales.sales', 'dataset-storesales.targets'])

  const targets = await entry('targets')
  const [dataset, served, rows, asOf] = cells(targets)
  // Point 18: the dataset opens its binding; its Data Source is a link too, kept on one line.
  expect(within(dataset).getByRole('link', { name: 'targets' })).toHaveAttribute('href', rowHref('Dataset Binding', 'storesales.targets'))
  expect(within(dataset).getByRole('link', { name: 'storesales-warehouse' })).toHaveAttribute('href', rowHref('Data Source', 'storesales-warehouse'))
  expect(within(dataset).getByTestId('dataset-source')).toHaveTextContent('Data Source: storesales-warehouse')
  expect(within(dataset).getByTestId('dataset-source')).toHaveClass('whitespace-nowrap')
  // Point 19: a stand-in, when it was loaded and by whom, its note and its expected day.
  expect(within(served).getByTestId('served-from')).toHaveTextContent('Stand-in')
  expect(within(served).getByTestId('stand-in-loaded')).toHaveTextContent(`Loaded ${today()} by Administrator`)
  expect(within(served).getByRole('link', { name: 'Administrator' })).toHaveAttribute('href', rowHref('Person', 'Administrator'))
  expect(served).toHaveTextContent('From the planning workbook')
  expect(served).toHaveTextContent('Real data expected by 15-Dec-2026')
  // Point 20, and point 24: the snapshot behind Rows and As Of is a record, so its time opens it.
  expect(rows).toHaveTextContent(/^3$/)
  expect(asOf.textContent).toMatch(INSTANT)
  expect(within(asOf).getByRole('link', { name: INSTANT })).toHaveAttribute('href', rowHref('Dataset Snapshot', (await snapshotOf(admin, 'targets'))!))
  // Every cell of a row keeps space above and below what it holds, so rows of several lines stay apart.
  for (const cell of cells(targets)) expect(cell.firstElementChild).toHaveClass('py-2')
  expect(within(targets).getByRole('button', { name: 'Switch targets To Warehouse' })).toHaveTextContent('Switch To Warehouse')

  const sales = await entry('sales')
  const [salesName, salesServed, salesRows, salesAsOf] = cells(sales)
  // No binding yet, so the name is plain text; the warehouse is still a link.
  expect(within(salesName).queryByRole('link', { name: 'sales' })).toBeNull()
  expect(salesName).toHaveTextContent('sales')
  expect(within(salesName).getByRole('link', { name: 'storesales-warehouse' })).toBeInTheDocument()
  expect(salesServed.textContent).toBe('Warehouse')
  expect(salesRows).toHaveTextContent(/^2$/)
  expect(within(salesAsOf).getByRole('link', { name: INSTANT })).toHaveAttribute('href', rowHref('Dataset Snapshot', (await snapshotOf(admin, 'sales'))!))
  expect(within(sales).queryByRole('button')).toBeNull()
})

test('a dataset with no rows says so; one bound to a stand-in nobody has loaded says that too (points 19, 20)', async ({ admin, createUser }) => {
  await storeSales(admin, createUser)
  await admin.post('/api/table/Dataset%20Binding', { row_id: 'storesales.targets', served_from: 'Stand-in', note: 'Waiting for the workbook' })
  await renderApp(PAGE, admin)

  const [, served, rows, asOf] = cells(await entry('targets'))
  expect(within(served).getByTestId('served-from')).toHaveTextContent('Stand-in')
  expect(within(served).getByTestId('stand-in-unloaded').textContent).toBe('No stand-in loaded yet')
  expect(served).toHaveTextContent('Waiting for the workbook')
  expect(within(served).queryByTestId('stand-in-loaded')).toBeNull()
  expect(rows).toHaveTextContent('No data yet')
  // No snapshot, so nothing to open.
  expect(asOf.textContent).toBe('—')
  expect(within(asOf).queryByRole('link')).toBeNull()

  const [, salesServed, salesRows] = cells(await entry('sales'))
  expect(salesServed.textContent).toBe('Warehouse')
  expect(salesRows).toHaveTextContent('No data yet')
})

test('a dataset bound to a stand-in while the warehouse\'s rows are still served says the app still shows them (point 19)', async ({ admin, createUser }) => {
  await storeSales(admin, createUser)
  await warehouseTargets(WAREHOUSE_TARGETS)
  expect(await buildSnapshot('storesales.targets')).toMatchObject({ status: 'activated', rowCount: 2 })
  // Someone set the binding and loaded no file.
  await admin.post('/api/table/Dataset%20Binding', { row_id: 'storesales.targets', served_from: 'Stand-in' })
  await renderApp(PAGE, admin)

  const targets = await entry('targets')
  const [, served, rows, asOf] = cells(targets)
  expect(within(served).getByTestId('served-from')).toHaveTextContent('Stand-in')
  expect(within(served).getByTestId('stand-in-unloaded').textContent).toBe('No stand-in loaded yet. The app still shows the warehouse’s rows.')
  // Nothing was loaded, so nobody is named as having loaded it.
  expect(within(served).queryByTestId('stand-in-loaded')).toBeNull()
  expect(served).not.toHaveTextContent('Loaded')
  expect(rows).toHaveTextContent(/^2$/)
  expect(within(asOf).getByRole('link', { name: INSTANT })).toBeInTheDocument()
  expect(within(targets).getByRole('button', { name: 'Switch targets To Warehouse' })).toBeEnabled()
})

test('with no app declaring a dataset, the page says so (point 22)', async ({ admin }) => {
  await renderApp(PAGE, admin)
  expect(await screen.findByRole('heading', { level: 3, name: 'No Datasets Yet' }, T)).toBeInTheDocument()
  expect(screen.getByText('No installed app declares a dataset.')).toBeInTheDocument()
})

test('Switch To Warehouse says it is running, cannot be pressed twice, then says the dataset reads the warehouse and how many rows it has (point 21)', async ({ admin, createUser }) => {
  await standingIn(admin, createUser)
  await warehouseTargets(WAREHOUSE_TARGETS)
  await renderApp(PAGE, admin)
  const button = within(await entry('targets')).getByRole('button', { name: 'Switch targets To Warehouse' })

  const slow = holdResponses('/switch_to_warehouse')
  await userEvent.click(button)
  await slow.asked
  expect(button).toHaveTextContent('Switching…')
  expect(button).toBeDisabled()
  slow.release()

  const verdict = await screen.findByText('targets now reads the warehouse: 2 rows.', {}, T)
  expect(verdict.closest('[role="status"]')).toBeInTheDocument()
  // Above the lists.
  expect(verdict.compareDocumentPosition(screen.getByRole('region', { name: 'Store Sales datasets' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await waitFor(async () => expect(within(cells(await entry('targets'))[1]).getByTestId('served-from')).toHaveTextContent('Warehouse'), T)
  const [, served, rows] = cells(await entry('targets'))
  expect(served).not.toHaveTextContent('From the planning workbook')
  expect(rows).toHaveTextContent(/^2$/)
  expect(within(await entry('targets')).queryByRole('button')).toBeNull()
})

test('when the warehouse cannot supply the data, the dataset stays on its stand-in and the page says why (point 21)', async ({ admin, createUser }) => {
  await standingIn(admin, createUser)
  await renderApp(PAGE, admin)
  await userEvent.click(within(await entry('targets')).getByRole('button', { name: 'Switch targets To Warehouse' }))

  const verdict = await screen.findByText(/^targets stays on its stand-in\. The warehouse refresh was refused: .*the query returned no rows\.$/, {}, T)
  expect(verdict.closest('[role="status"]')).toBeInTheDocument()
  const targets = await entry('targets')
  expect(within(targets).getByTestId('served-from')).toHaveTextContent('Stand-in')
  await waitFor(() => expect(within(targets).getByRole('button', { name: 'Switch targets To Warehouse' })).toBeEnabled())
  expect(cells(targets)[2]).toHaveTextContent(/^3$/)
})

test('a switch the server refuses outright is reported as a failure, and the list is read again', async ({ admin, createUser }) => {
  await standingIn(admin, createUser)
  await warehouseTargets(WAREHOUSE_TARGETS)
  await renderApp(PAGE, admin)
  const button = within(await entry('targets')).getByRole('button', { name: 'Switch targets To Warehouse' })
  // Someone else switched it meanwhile; this page still offers the button.
  expect(await admin.post(`${TARGETS}switch_to_warehouse`, {})).toMatchObject({ switched: true })
  await userEvent.click(button)

  expect(await screen.findByRole('alert', {}, T)).toHaveTextContent('Could not switch targets to the warehouse: targets already reads the warehouse')
  await waitFor(async () => expect(within(await entry('targets')).queryByRole('button')).toBeNull(), T)
})

test('a list that cannot be read offers a retry that recovers (point 22)', async ({ admin, createUser }) => {
  await standingIn(admin, createUser)
  const manager = await createUser({ email: 'datasets-reader@example.test', roles: ['System Manager'] })
  await renderApp('/featherbase/admin', manager)
  const link = await screen.findByTestId('datasets-link', {}, T)
  const setRoles = async (roles: { role: string }[]) => {
    const person = await admin.get<Record<string, unknown>>(`/api/table/Person/${manager.user}`)
    await admin.post('/api/save_row', { table: 'Person', row: { ...person, roles } })
  }
  await setRoles([])
  await userEvent.click(link)
  expect(await screen.findByText('The datasets could not be loaded.', {}, T)).toBeInTheDocument()
  await setRoles([{ role: 'System Manager' }])
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await entry('targets')).toBeInTheDocument()
  expect(screen.queryByText('The datasets could not be loaded.')).not.toBeInTheDocument()
})

test('while the list is on its way the page says it is loading', async ({ admin, createUser }) => {
  await standingIn(admin, createUser)
  const slow = holdResponses('/api/datasets')
  await renderApp(PAGE, admin)
  await slow.asked
  expect(await screen.findByText('Loading datasets')).toBeInTheDocument()
  slow.release()
  expect(await entry('targets')).toBeInTheDocument()
})
