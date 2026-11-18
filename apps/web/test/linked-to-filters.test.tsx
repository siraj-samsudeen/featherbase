// #1276 (relational navigation, slice 5): Add filter's Linked to… and Not
// linked to…, the hover actions on every link cell, and old Explore addresses
// opening the filtered list. Fixture graph:
//   Xe Vehicle ← Xe Accident.vehicle ← Xe Claim.accident
//   Xe Vehicle ← Xe Service.vehicle
import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { decodePath } from '../src/lib/nav-path'

configure({ asyncUtilTimeout: 10_000 })
type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent

const VEHICLE = 'Xe Vehicle'
const ACCIDENT = 'Xe Accident'
const SERVICE = 'Xe Service'
const CLAIM = 'Xe Claim'

async function seed(admin: Admin) {
  const title = { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true }
  const ref = (column_name: string, reference_table: string) =>
    ({ column_name, column_type: 'Reference', label: column_name === 'vehicle' ? 'Vehicle' : 'Accident', reference_table, in_list_view: true })
  for (const [name, columns] of [
    [VEHICLE, [title]], [ACCIDENT, [title, ref('vehicle', VEHICLE), { column_name: 'cost', column_type: 'Currency', label: 'Cost', in_list_view: true }]],
    [SERVICE, [title, ref('vehicle', VEHICLE)]], [CLAIM, [title, ref('accident', ACCIDENT)]],
  ] as const)
    await admin.post('/api/table_def', { name, title_column: 'title', columns })
  const insert = async (table: string, row: Record<string, unknown>) =>
    (await admin.post<{ row_id: string }>('/api/save_row', { table, row })).row_id
  const v1 = await insert(VEHICLE, { title: 'Truck 1' })
  const v2 = await insert(VEHICLE, { title: 'Truck 2' })
  const a1 = await insert(ACCIDENT, { title: 'Rear bump', vehicle: v1, cost: 1000 })
  await insert(ACCIDENT, { title: 'Side scrape', vehicle: v1, cost: 500 })
  await insert(ACCIDENT, { title: 'Windshield', vehicle: v2, cost: 300 })
  await insert(SERVICE, { title: 'Oil change', vehicle: v1 })
  await insert(CLAIM, { title: 'Claim rear bump', accident: a1 })
  return { v1, v2, a1 }
}

const listPath = (table: string) => `/featherbase/admin/table/${tableSlug(table)}?filters=${enc('[]')}`
const rowTitles = () => [...document.querySelectorAll('tbody [data-title-cell]')].map((c) => c.textContent ?? '')
const searchOf = (r: { router: unknown }) => (r.router as { state: { location: { pathname: string; search: { filters?: string; path?: unknown } } } }).state.location
/** The list's filters as the address holds them: on the walk's current step. */
const addressFilters = (r: { router: unknown }) => {
  const path = decodePath(searchOf(r).search.path)!
  return path.steps[path.at].filters
}

async function openLinked(choice: 'Linked to…' | 'Not linked to…') {
  await userEvent.click(await screen.findByTestId('filter-toggle'))
  const field = await screen.findByTestId('filter-field')
  await waitFor(() => expect(within(field).getByRole('option', { name: choice })).toBeInTheDocument())
  await userEvent.selectOptions(field, within(field).getByRole('option', { name: choice }))
}

async function chooseTable(step: number, label: string) {
  const select = (await screen.findAllByTestId('linked-table'))[step]
  await waitFor(() => expect(within(select).getByRole('option', { name: label })).toBeInTheDocument())
  await userEvent.selectOptions(select, within(select).getByRole('option', { name: label }))
}

const stepCard = (step: number) => screen.getAllByTestId('linked-step')[step]
const choice = async (step: number, name: string) =>
  within(stepCard(step)).findByText(name).then((el) => el.closest('[data-testid=linked-choice]') as HTMLElement)

test('Linked to a Table, picking rows of it with how many rows each links to', async ({ admin }) => {
  await seed(admin)
  await renderApp(listPath(ACCIDENT), admin)
  await screen.findByText('Windshield')
  // Explore's totals live on the list: an exact sum over every row the filters keep.
  await waitFor(() => expect(screen.getByTestId('list-sum')).toHaveTextContent(/Σ Cost: \D*1,800/))
  await openLinked('Linked to…')
  await chooseTable(0, VEHICLE)
  await waitFor(() => expect(within(stepCard(0)).getByTestId('linked-step-count')).toHaveTextContent(`${VEHICLE}: 2 match`))
  await waitFor(async () => expect(within(await choice(0, 'Truck 1')).getByTestId('linked-choice-count')).toHaveTextContent('2'))
  expect(within(await choice(0, 'Truck 2')).getByTestId('linked-choice-count')).toHaveTextContent('1')
  await userEvent.click(within(await choice(0, 'Truck 2')).getByRole('checkbox'))
  await userEvent.click(screen.getByTestId('linked-add'))
  await waitFor(() => expect(rowTitles()).toEqual(['Windshield']))
  await waitFor(() => expect(screen.getByTestId('list-sum')).toHaveTextContent(/Σ Cost: \D*300/))
  const chip = screen.getByTestId('filter-chip')
  await waitFor(() => expect(chip).toHaveTextContent(`Linked to ${VEHICLE}: Truck 2`))
  await waitFor(() => expect(within(chip).getByTestId('linked-step-total')).toHaveTextContent('1'))
})

test('with none picked, a step’s search is part of the filter', async ({ admin }) => {
  await seed(admin)
  const r = await renderApp(listPath(ACCIDENT), admin)
  await screen.findByText('Windshield')
  await openLinked('Linked to…')
  await chooseTable(0, VEHICLE)
  await userEvent.type(await screen.findByTestId('linked-search'), 'Truck 2')
  await waitFor(() => expect(within(stepCard(0)).getByTestId('linked-step-count')).toHaveTextContent(`${VEHICLE}: 1 match· none picked: those matching "Truck 2"`))
  await userEvent.click(screen.getByTestId('linked-add'))
  await waitFor(() => expect(rowTitles()).toEqual(['Windshield']))
  expect(screen.getByTestId('filter-chip')).toHaveTextContent(`Linked to ${VEHICLE} matching "Truck 2"`)
  expect(addressFilters(r)).toEqual([['vehicle', 'related', { table: VEHICLE, filters: [['title', 'like', '%Truck 2%']] }]])
})

test('a chain: Claims linked to Accidents linked to one Vehicle, each step with its count', async ({ admin }) => {
  await seed(admin)
  const r = await renderApp(listPath(CLAIM), admin)
  await screen.findByText('Claim rear bump')
  await openLinked('Linked to…')
  await chooseTable(0, ACCIDENT)
  await userEvent.click(await screen.findByTestId('linked-link-on'))
  await chooseTable(1, VEHICLE)
  await userEvent.click(within(await choice(1, 'Truck 2')).getByRole('checkbox'))
  // The step before narrows to the accidents of the picked vehicle.
  await waitFor(() => expect(within(stepCard(0)).getByTestId('linked-step-count')).toHaveTextContent(`${ACCIDENT}: 1 match`))
  await userEvent.click(screen.getByTestId('linked-add'))
  await waitFor(() => expect(screen.queryByText('Claim rear bump')).not.toBeInTheDocument())
  expect(screen.getByTestId('filter-chip')).toHaveTextContent(new RegExp(`Linked to ${ACCIDENT}\\d* › linked to ${VEHICLE}: Truck 2`))
  // The filter lives in the address, as every filter does.
  expect(addressFilters(r)).toEqual([['accident', 'related', {
    table: ACCIDENT, filters: [['vehicle', 'related', { table: VEHICLE, filters: [['row_id', 'in', [expect.any(String)]]] }]],
  }]])
})

test('choosing another Table for a step drops the steps after it', async ({ admin }) => {
  await seed(admin)
  await renderApp(listPath(CLAIM), admin)
  await screen.findByText('Claim rear bump')
  await openLinked('Linked to…')
  await chooseTable(0, ACCIDENT)
  await userEvent.click(await screen.findByTestId('linked-link-on'))
  await chooseTable(1, VEHICLE)
  expect(screen.getAllByTestId('linked-step')).toHaveLength(2)
  await userEvent.selectOptions(screen.getAllByTestId('linked-table')[0], '')
  expect(screen.getAllByTestId('linked-step')).toHaveLength(1)
  expect(screen.getByTestId('linked-add')).toBeDisabled()
})

test('Not linked to a Table that links back: vehicles never serviced', async ({ admin }) => {
  await seed(admin)
  const r = await renderApp(listPath(VEHICLE), admin)
  await screen.findByText('Truck 2')
  await openLinked('Not linked to…')
  await chooseTable(0, SERVICE)
  await waitFor(() => expect(within(stepCard(0)).getByTestId('linked-step-count')).toHaveTextContent(`${SERVICE}: 1 match`))
  await userEvent.click(screen.getByTestId('linked-add'))
  await waitFor(() => expect(rowTitles()).toEqual(['Truck 2']))
  expect(screen.getByTestId('filter-chip')).toHaveTextContent(`Not linked to ${SERVICE}`)
  expect(addressFilters(r)).toEqual([['row_id', 'not related', { table: SERVICE, column: 'vehicle', filters: [] }]])
})

test('a link cell offers Filter and Go there on hover', async ({ admin }) => {
  const { v2 } = await seed(admin)
  const r = await renderApp(listPath(ACCIDENT), admin)
  const vehicleCell = async () => within((await screen.findByText('Windshield')).closest('tr')!).getByTestId('cell-vehicle').closest('td')!
  await userEvent.click(await within(await vehicleCell()).findByRole('button', { name: 'Filter' }))
  await waitFor(() => expect(rowTitles()).toEqual(['Windshield']))
  expect(screen.getByTestId('filter-chip')).toHaveTextContent('Vehicle = Truck 2')
  await userEvent.click(await within(await vehicleCell()).findByRole('button', { name: 'Go there' }))
  await waitFor(() => expect(searchOf(r).pathname).toBe(`/featherbase/admin/table/${tableSlug(VEHICLE)}/row/${v2}`))
})

test('Filter on a link to a row of any Table keeps its Table too, since an id may repeat across Tables', async ({ admin }) => {
  for (const name of ['Xe Plant', 'Xe Unit']) {
    await admin.post('/api/table_def', { name, id_pattern: 'prompt', title_column: 'title', columns: [{ column_name: 'title', column_type: 'Data' }] })
    await admin.post('/api/save_row', { table: name, row: { row_id: 'R1', title: `${name} one` } })
  }
  await admin.post('/api/table_def', { name: 'Xe Decision', title_column: 'title', columns: [
    { column_name: 'title', column_type: 'Data', in_list_view: true },
    { column_name: 'shapes_table', column_type: 'Reference', reference_table: 'Table' },
    { column_name: 'shapes', label: 'Shapes', column_type: 'Reference', table_column: 'shapes_table', choices: 'Xe Plant\nXe Unit', in_list_view: true },
  ] })
  await admin.post('/api/save_row', { table: 'Xe Decision', row: { title: 'Close plant', shapes_table: 'Xe Plant', shapes: 'R1' } })
  await admin.post('/api/save_row', { table: 'Xe Decision', row: { title: 'Merge unit', shapes_table: 'Xe Unit', shapes: 'R1' } })
  const r = await renderApp(listPath('Xe Decision'), admin)
  const cell = within((await screen.findByText('Close plant')).closest('tr')!).getByTestId('cell-shapes').closest('td')!
  await userEvent.click(await within(cell).findByRole('button', { name: 'Filter' }))
  await waitFor(() => expect(rowTitles()).toEqual(['Close plant']))
  expect(addressFilters(r)).toEqual([['shapes_table', '=', 'Xe Plant'], ['shapes', '=', 'R1']])
})

test('an old Explore address opens the matching filtered list', async ({ admin }) => {
  const { v1 } = await seed(admin)
  const chain = enc(JSON.stringify([
    { mode: 'backlink', table: ACCIDENT, column: 'vehicle' },
    { mode: 'backlink', table: CLAIM, column: 'accident' },
  ]))
  const r = await renderApp(`/featherbase/admin/explore?root=${enc(VEHICLE)}&chain=${chain}&select=${enc(JSON.stringify([v1]))}`, admin)
  await waitFor(() => expect(searchOf(r).pathname).toBe(`/featherbase/admin/table/${tableSlug(CLAIM)}`))
  await screen.findByText('Claim rear bump')
  await waitFor(() => expect(screen.getByTestId('filter-chip')).toHaveTextContent(new RegExp(`Linked to ${ACCIDENT}\\d* › linked to ${VEHICLE}: Truck 1`)))
})

test('Explore is gone from the sidebar and the list’s View menu', async ({ admin }) => {
  await seed(admin)
  await renderApp(listPath(VEHICLE), admin)
  await screen.findByText('Truck 2')
  expect(screen.queryByTestId('explore-link')).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole('button', { name: /^View$/ }))
  expect(screen.queryByTestId('open-explore')).not.toBeInTheDocument()
})
