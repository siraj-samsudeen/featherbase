// #1276 (relational navigation, slice 5): Add filter's Linked to… and Not
// linked to…, the hover actions on every link cell, and old Explore addresses
// opening the filtered list. Fixture graph:
//   Xe Vehicle ← Xe Accident.vehicle ← Xe Claim.accident
//   Xe Vehicle ← Xe Service.vehicle
import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { vi } from 'vitest'
import { grantRole } from 'server/test/fixtures'
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
    await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name, title_column: 'title', columns })
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
  await waitFor(() => expect(within(stepCard(0)).getByTestId('linked-step-count')).toHaveTextContent(`2 ${VEHICLE} to choose from`))
  await waitFor(async () => expect(within(await choice(0, 'Truck 1')).getByTestId('linked-choice-count')).toHaveTextContent('2'))
  expect(within(await choice(0, 'Truck 2')).getByTestId('linked-choice-count')).toHaveTextContent('1')
  // A tick taken back is no longer picked.
  await userEvent.click(within(await choice(0, 'Truck 1')).getByRole('checkbox'))
  await waitFor(() => expect(within(stepCard(0)).getByTestId('linked-step-count')).toHaveTextContent('1 picked'))
  await userEvent.click(within(await choice(0, 'Truck 1')).getByRole('checkbox'))
  await userEvent.click(within(await choice(0, 'Truck 2')).getByRole('checkbox'))
  await userEvent.click(screen.getByTestId('linked-add'))
  // Adding it closes the Add filter row.
  expect(screen.getByTestId('filter-toggle')).toHaveAttribute('aria-expanded', 'false')
  await waitFor(() => expect(rowTitles()).toEqual(['Windshield']))
  await waitFor(() => expect(screen.getByTestId('list-sum')).toHaveTextContent(/Σ Cost: \D*300/))
  const chip = screen.getByTestId('filter-chip')
  // #1289 option C: a Linked to filter that a Click To Narrow list holds reads as that list's
  // pick, green ("Vehicle: Truck 2"), and the panel shows each value's count live.
  await waitFor(() => expect(chip).toHaveTextContent(`${VEHICLE}: Truck 2`))
  expect(chip).toHaveAttribute('data-tone', 'picked')
  // How many rows each step holds is the chip's tooltip, as on every Linked to chip.
  await waitFor(() => expect(within(chip).getByTestId('linked-words')).toHaveAttribute('title', `${VEHICLE}: 1 linked`))
})

test('with none picked, a step’s search is part of the filter', async ({ admin }) => {
  await seed(admin)
  const r = await renderApp(listPath(ACCIDENT), admin)
  await screen.findByText('Windshield')
  await openLinked('Linked to…')
  await chooseTable(0, VEHICLE)
  await userEvent.type(await screen.findByTestId('linked-search'), 'Truck 2')
  await waitFor(() => expect(within(stepCard(0)).getByTestId('linked-step-count')).toHaveTextContent(`1 ${VEHICLE} to choose from· none picked: those matching "Truck 2"`))
  await userEvent.click(screen.getByTestId('linked-add'))
  await waitFor(() => expect(rowTitles()).toEqual(['Windshield']))
  expect(screen.getByTestId('filter-chip')).toHaveTextContent(`Linked to ${VEHICLE} matching "Truck 2"`)
  expect(addressFilters(r)).toEqual([['vehicle', 'related', { table: VEHICLE, filters: [['title', 'like', '%Truck 2%']] }]])
})

test('the list’s sum follows its rows when some are deleted', async ({ admin }) => {
  await seed(admin)
  await renderApp(listPath(ACCIDENT), admin)
  await waitFor(() => expect(screen.getByTestId('list-sum')).toHaveTextContent(/Σ Cost: \D*1,800/))
  await userEvent.click(within((await screen.findByText('Windshield')).closest('tr')!).getByTestId('row-check'))
  await userEvent.click(await screen.findByTestId('bulk-delete'))
  await userEvent.click(await screen.findByTestId('bulk-delete-confirm'))
  await waitFor(() => expect(screen.getByTestId('list-sum')).toHaveTextContent(/Σ Cost: \D*1,500/))
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
  await waitFor(() => expect(within(stepCard(0)).getByTestId('linked-step-count')).toHaveTextContent(`1 ${ACCIDENT} to choose from`))
  await userEvent.click(screen.getByTestId('linked-add'))
  // The claim leaves the rows (it stays in the panel, ruled out).
  await waitFor(() => expect(rowTitles()).not.toContain('Claim rear bump'))
  // #1289 option C: the chain is the Vehicle list's pick, through Accident.
  await waitFor(() => expect(screen.getByTestId('filter-chip')).toHaveTextContent(`${VEHICLE}: Truck 2`))
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
  await userEvent.click(screen.getByTestId('linked-step-remove'))
  expect(screen.getAllByTestId('linked-step')).toHaveLength(1)
  await userEvent.click(await screen.findByTestId('linked-link-on'))
  await chooseTable(1, VEHICLE)
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
  await waitFor(() => expect(within(stepCard(0)).getByTestId('linked-step-count')).toHaveTextContent(`1 ${SERVICE} to choose from`))
  await userEvent.click(screen.getByTestId('linked-add'))
  await waitFor(() => expect(rowTitles()).toEqual(['Truck 2']))
  expect(screen.getByTestId('filter-chip')).toHaveTextContent(`Not linked to ${SERVICE}`)
  expect(addressFilters(r)).toEqual([['row_id', 'not related', { table: SERVICE, column: 'vehicle', filters: [] }]])
})

test('a link cell offers Filter and Go there on hover', async ({ admin }) => {
  const { v2 } = await seed(admin)
  const r = await renderApp(listPath(ACCIDENT), admin)
  // The table's own row: the Click To Narrow panel names the accident too.
  const vehicleCell = async () => within((await within(await screen.findByTestId('list-table-scroll')).findByText('Windshield')).closest('tr')!).getByTestId('cell-vehicle').closest('td')!
  // Out of the Tab order until focus is in the cell.
  const filterButton = await within(await vehicleCell()).findByRole('button', { name: 'Filter' })
  expect(filterButton).toHaveAttribute('tabindex', '-1')
  within(await vehicleCell()).getByRole('link').focus()
  await waitFor(() => expect(filterButton).toHaveAttribute('tabindex', '0'))
  ;(document.activeElement as HTMLElement).blur()
  await waitFor(() => expect(filterButton).toHaveAttribute('tabindex', '-1'))
  await userEvent.click(filterButton)
  await waitFor(() => expect(rowTitles()).toEqual(['Windshield']))
  // #1289: the list has a Vehicle box, so the box shows the filter and no chip repeats it.
  await waitFor(() => expect(screen.getByTestId('std-filter-vehicle')).toHaveValue('Truck 2'))
  expect(screen.queryAllByTestId('filter-chip')).toHaveLength(0)
  // Filter again on the same link replaces its filter rather than adding a second.
  await userEvent.click(await within(await vehicleCell()).findByRole('button', { name: 'Filter' }))
  await waitFor(() => expect(addressFilters(r)).toEqual([['vehicle', '=', v2]]))
  await userEvent.click(await within(await vehicleCell()).findByRole('button', { name: 'Go there' }))
  await waitFor(() => expect(searchOf(r).pathname).toBe(`/featherbase/admin/table/${tableSlug(VEHICLE)}/row/${v2}`))
})

test('Filter on a link to a row of any Table keeps its Table too, since an id may repeat across Tables', async ({ admin }) => {
  for (const name of ['Xe Plant', 'Xe Unit']) {
    await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name, id_pattern: 'prompt', title_column: 'title', columns: [{ column_name: 'title', column_type: 'Data' }] })
    await admin.post('/api/save_row', { table: name, row: { row_id: 'R1', title: `${name} one` } })
  }
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Xe Decision', title_column: 'title', columns: [
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

/** Orders holding lines that point at items: a sub-table both ways. */
async function seedLines(admin: Admin) {
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Xe Item', id_pattern: 'prompt', title_column: 'title', columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] })
  await admin.post('/api/table_def', { name: 'Xe Order Line', kind: 'sub_table', columns: [{ column_name: 'item', column_type: 'Reference', reference_table: 'Xe Item', in_list_view: true }] })
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Xe Order', id_pattern: 'prompt', title_column: 'title', columns: [
    { column_name: 'title', column_type: 'Data', in_list_view: true }, { column_name: 'lines', column_type: 'Sub-table', row_table: 'Xe Order Line' },
  ] })
}

test('an item links to the orders whose lines point at it, via those lines', async ({ admin }) => {
  await seedLines(admin)
  await admin.post('/api/save_row', { table: 'Xe Item', row: { row_id: 'I-1', title: 'Bolt' } })
  await renderApp(listPath('Xe Item'), admin)
  await screen.findByText('Bolt')
  await openLinked('Linked to…')
  await chooseTable(0, 'Xe Order · via Xe Order Line')
})

test('a sub-table’s list links to the rows holding it', async ({ admin }) => {
  await seedLines(admin)
  await renderApp(listPath('Xe Order Line'), admin)
  await openLinked('Linked to…')
  await chooseTable(0, 'Xe Order')
})

// Verifier FAIL (A2): a reader who may read Claims and Accidents but not
// Vehicles is offered no step into Vehicles, at any step.
test('Linked to offers only the Tables the viewer may read', async ({ admin, createUser }) => {
  await seed(admin)
  await grantRole(admin, { table: [CLAIM, ACCIDENT], role: 'Xe Claims Reader', can_read: true })
  const reader = await createUser({ roles: ['Xe Claims Reader'] })
  await renderApp(listPath(CLAIM), reader)
  await screen.findByText('Claim rear bump')
  await openLinked('Linked to…')
  await chooseTable(0, ACCIDENT)
  await userEvent.click(await screen.findByTestId('linked-link-on'))
  const second = (await screen.findAllByTestId('linked-table'))[1]
  await waitFor(() => expect(within(second).getByRole('option', { name: CLAIM })).toBeInTheDocument())
  expect(within(second).queryByRole('option', { name: VEHICLE })).not.toBeInTheDocument()
})

test('a step whose rows cannot be read says so instead of waiting', async ({ admin }) => {
  await seed(admin)
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return url.includes(`/api/table/${enc(VEHICLE)}?`) ? Promise.resolve(new Response(JSON.stringify({ error: { type: 'PermissionError', message: 'No' } }), { status: 403 })) : real(input, init)
  })
  await renderApp(listPath(ACCIDENT), admin)
  await screen.findByText('Windshield')
  await openLinked('Linked to…')
  await chooseTable(0, VEHICLE)
  expect(await screen.findByTestId('linked-step-error', {}, { timeout: 10_000 })).toHaveTextContent(`You cannot pick rows of ${VEHICLE} here.`)
  vi.restoreAllMocks()
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
  // #1289 option C: the chain is the Vehicle list's pick, through Accident, so it reads as that
  // list's green chip once the panel's lists are known; its step counts stay the tooltip.
  await waitFor(() => expect(screen.getByTestId('filter-chip')).toHaveTextContent(`${VEHICLE}: Truck 1`))
  expect(screen.getByTestId('filter-chip')).toHaveAttribute('data-tone', 'picked')
})

test('Explore is gone from the sidebar and the list’s View menu', async ({ admin }) => {
  await seed(admin)
  await renderApp(listPath(VEHICLE), admin)
  await screen.findByText('Truck 2')
  expect(screen.queryByTestId('explore-link')).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole('button', { name: /^View$/ }))
  expect(screen.queryByTestId('open-explore')).not.toBeInTheDocument()
})
