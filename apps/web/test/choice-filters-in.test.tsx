// #820: a filter on a Choice column ticks one or more of its choices (`in`),
// and each Choice column has at most one filter, shared by Add filter, the
// quick filter box and the chip. Against the real in-process server.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { decodePath } from '../src/lib/nav-path'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]

const T = 'Section Mapping'
const enc = encodeURIComponent

const FLOORS = ['Ground', 'First Floor', 'Second Floor', 'Third Floor']
const SECTIONS = [
  'Sarees', 'Shawls', 'Shirts', 'Shoe Rack', 'Kids', 'Toys',
  'Saree Rack', 'Bags', 'Belts', 'Rack Ends', 'Watches', 'Perfume',
]

// code, floor, state (labelled Status; status is a reserved name), section, owner, active
const ROWS: [string, string, string, string, string, boolean][] = [
  ['R1', 'Ground', 'Open', 'Sarees', 'Asha', true],
  ['R2', 'Ground', 'Closed', 'Shoe Rack', 'Ravi', false],
  ['R3', 'First Floor', 'Open', 'Saree Rack', 'Ashok', true],
  ['R4', 'First Floor', 'Closed', 'Shirts', 'Meena', true],
  ['R5', 'Second Floor', 'Open', 'Rack Ends', 'Kumar', false],
  ['R6', 'Third Floor', 'Closed', 'Toys', 'Lata', true],
]

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'code', column_type: 'Data', label: 'Code', in_list_view: true },
      { column_name: 'floor', column_type: 'Choice', label: 'Floor', choices: FLOORS.join('\n'), in_list_view: true },
      { column_name: 'state', column_type: 'Choice', label: 'Status', choices: 'Open\nClosed', in_list_view: true },
      { column_name: 'section', column_type: 'Choice', label: 'Section', choices: SECTIONS.join('\n'), in_list_view: true },
      { column_name: 'owner_name', column_type: 'Data', label: 'Owner', in_list_view: true },
      { column_name: 'active', column_type: 'Check', label: 'Active', in_list_view: true },
    ],
  })
  for (const [code, floor, state, section, owner_name, active] of ROWS)
    await admin.post('/api/save_row', { table: T, row: { code, floor, state, section, owner_name, active } })
}

async function openList(admin: Admin, filters?: unknown[]) {
  const { router } = await renderApp(`${tableHref(T)}${filters ? `?filters=${enc(JSON.stringify(filters))}` : ''}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
  await screen.findByTestId('list-rows')
  await waitFor(() => expect(codes().length).toBeGreaterThan(0))
  return router
}

const codes = () =>
  [...screen.getByTestId('list-rows').querySelectorAll('[data-testid="cell-code"]')].map((e) => e.textContent ?? '').sort()

const options = (testId: string) =>
  [...screen.getByTestId(testId).querySelectorAll('option')].map((o) => o.getAttribute('value'))

const tickNames = (list: HTMLElement) =>
  within(list).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label') ?? c.closest('label')?.textContent ?? '')

/** Picks a column in Add filter and opens its list of choices. */
function addFilterOn(column: string) {
  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: column } })
  const button = screen.getByTestId('filter-value')
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button)
  return screen.getByTestId('filter-choices')
}

test('Adding a filter on Status offers its choices to tick, and only in', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  const list = addFilterOn('state')
  expect(options('filter-op')).toEqual(['in'])
  expect(tickNames(list)).toEqual(['Open', 'Closed'])
})

/** Ticks the named choices in an open list. */
function tick(list: HTMLElement, ...names: string[]) {
  for (const name of names) fireEvent.click(within(list).getByRole('checkbox', { name }))
}

test("Ticking Ground and First Floor shows both floors' rows, with one chip naming both", async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  tick(addFilterOn('floor'), 'Ground', 'First Floor')
  fireEvent.click(screen.getByTestId('filter-add'))
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2', 'R3', 'R4']))
  expect(screen.getAllByTestId('filter-chip').map((c) => c.textContent)).toEqual(['Floor in Ground, First Floor×'])
})

test('Floor in Ground and First Floor plus Status Open shows only Open rows on those floors', async ({ admin }) => {
  await seed(admin)
  await openList(admin, [['floor', 'in', ['Ground', 'First Floor']]])
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2', 'R3', 'R4']))
  tick(addFilterOn('state'), 'Open')
  fireEvent.click(screen.getByTestId('filter-add'))
  await waitFor(() => expect(codes()).toEqual(['R1', 'R3']))
  expect(screen.getAllByTestId('filter-chip').map((c) => c.textContent)).toEqual([
    'Floor in Ground, First Floor×',
    'Status in Open×',
  ])
})

test('Add stays off until at least one choice is ticked', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  const list = addFilterOn('floor')
  expect(screen.getByTestId('filter-add')).toBeDisabled()
  tick(list, 'Ground')
  expect(screen.getByTestId('filter-add')).toBeEnabled()
})

test('Yes/No columns keep = and !=, and text columns keep every operator', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: 'active' } })
  expect(options('filter-op')).toEqual(['=', '!='])
  expect(screen.getByTestId('filter-value').tagName).toBe('SELECT')
  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: 'floor' } })
  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: 'owner_name' } })
  expect(options('filter-op')).toEqual(['=', '!=', 'like', '>', '<', '>=', '<='])
  expect(screen.getByTestId('filter-op')).toHaveValue('=')
  expect(screen.getByTestId('filter-value').tagName).toBe('INPUT')
})

const ticked = (list: HTMLElement) =>
  within(list).getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked).map((c) => c.closest('label')?.textContent ?? '')
const chips = () => screen.queryAllByTestId('filter-chip').map((c) => c.textContent)

test('Adding Floor again opens with Ground ticked, and First Floor joins the same chip', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  tick(addFilterOn('floor'), 'Ground')
  fireEvent.click(screen.getByTestId('filter-add'))
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2']))

  const list = addFilterOn('floor')
  expect(ticked(list)).toEqual(['Ground'])
  tick(list, 'First Floor')
  fireEvent.click(screen.getByTestId('filter-add'))
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2', 'R3', 'R4']))
  expect(chips()).toEqual(['Floor in Ground, First Floor×'])
})

test('An older link or saved view with floor = Ground takes First Floor into one chip', async ({ admin }) => {
  await seed(admin)
  await openList(admin, [['floor', '=', 'Ground']])
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2']))
  const list = addFilterOn('floor')
  expect(ticked(list)).toEqual(['Ground'])
  tick(list, 'First Floor')
  fireEvent.click(screen.getByTestId('filter-add'))
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2', 'R3', 'R4']))
  expect(chips()).toEqual(['Floor in Ground, First Floor×'])
})

test('An older link with floor != Ground ticks the other floors, and unticking Third Floor leaves one in filter', async ({ admin }) => {
  await seed(admin)
  const router = await openList(admin, [['floor', '!=', 'Ground']])
  await waitFor(() => expect(codes()).toEqual(['R3', 'R4', 'R5', 'R6']))
  expect(ticked(openBox('floor'))).toEqual(['First Floor', 'Second Floor', 'Third Floor'])
  tick(openBox('floor'), 'Third Floor')
  await waitFor(() => expect(codes()).toEqual(['R3', 'R4', 'R5']))
  expect(chips()).toEqual(['Floor in First Floor, Second Floor×'])
  expect(addressFilters(router)).toEqual([['floor', 'in', ['First Floor', 'Second Floor']]])
})

type Router = Awaited<ReturnType<typeof openList>>

/** The filters the page address holds: the current step of its walk (#910)
 *  once the page has changed them, else the link's own `filters`. */
function addressFilters(router: Router): unknown[] {
  const params = new URLSearchParams((router.state as { location: { searchStr: string } }).location.searchStr)
  const path = decodePath(params.get('path'))
  if (path) return path.steps[path.at].filters ?? []
  const raw = params.get('filters')
  return raw ? (JSON.parse(raw) as unknown[]) : []
}

test('A link with two Floor filters opens as one chip, the address holds one filter, and the quick filter shows both ticked', async ({ admin }) => {
  await seed(admin)
  const router = await openList(admin, [['floor', '=', 'Ground'], ['floor', 'in', ['First Floor']]])
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2', 'R3', 'R4']))
  expect(chips()).toEqual(['Floor in Ground, First Floor×'])
  await waitFor(() => expect(addressFilters(router)).toEqual([['floor', 'in', ['Ground', 'First Floor']]]))
  fireEvent.click(screen.getByTestId('std-filter-floor'))
  expect(ticked(screen.getByTestId('std-choices-floor'))).toEqual(['Ground', 'First Floor'])
})

test('Filters on different columns, on text columns and on Yes/No columns are never merged', async ({ admin }) => {
  await seed(admin)
  const link = [
    ['owner_name', 'like', '%As%'],
    ['owner_name', 'like', '%sh%'],
    ['active', '=', 'Yes'],
    ['active', '!=', 'No'],
    ['floor', 'in', ['Ground', 'First Floor']],
    ['state', '=', 'Open'],
  ]
  const router = await openList(admin, link)
  await waitFor(() => expect(codes()).toEqual(['R1', 'R3']))
  expect(chips()).toEqual([
    'Owner like %As%×',
    'Owner like %sh%×',
    'Active = Yes×',
    'Active != No×',
    'Floor in Ground, First Floor×',
    'Status = Open×',
  ])
  expect(addressFilters(router)).toEqual(link)
})

/** Opens a quick filter box's list of choices. */
function openBox(column: string) {
  const button = screen.getByTestId(`std-filter-${column}`)
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button)
  return screen.getByTestId(`std-choices-${column}`)
}

test('Ticking Closed in the Status box narrows the rows, and unticking it brings them all back', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  tick(openBox('state'), 'Closed')
  await waitFor(() => expect(codes()).toEqual(['R2', 'R4', 'R6']))
  expect(chips()).toEqual(['Status in Closed×'])
  tick(openBox('state'), 'Closed')
  await waitFor(() => expect(codes()).toHaveLength(6))
  expect(chips()).toEqual([])
})

test('A filter added on Floor with Ground and First Floor shows both ticked in the Floor box', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  tick(addFilterOn('floor'), 'Ground', 'First Floor')
  fireEvent.click(screen.getByTestId('filter-add'))
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2', 'R3', 'R4']))
  expect(ticked(openBox('floor'))).toEqual(['Ground', 'First Floor'])
})

test('Unticking First Floor in the box leaves only Ground rows, and the chip names only Ground', async ({ admin }) => {
  await seed(admin)
  await openList(admin, [['floor', 'in', ['Ground', 'First Floor']]])
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2', 'R3', 'R4']))
  tick(openBox('floor'), 'First Floor')
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2']))
  expect(chips()).toEqual(['Floor in Ground×'])
})

test('Ticking every floor in the box removes the Floor filter, and every row shows', async ({ admin }) => {
  await seed(admin)
  await openList(admin, [['floor', 'in', ['Ground', 'First Floor']]])
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2', 'R3', 'R4']))
  tick(openBox('floor'), 'Second Floor', 'Third Floor')
  await waitFor(() => expect(codes()).toHaveLength(6))
  expect(chips()).toEqual([])
})

test('The box reads All with no filter, and "2 selected" with two choices ticked', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  expect(screen.getByTestId('std-filter-floor')).toHaveTextContent(/^All$/)
  tick(openBox('floor'), 'Ground', 'First Floor')
  await waitFor(() => expect(screen.getByTestId('std-filter-floor')).toHaveTextContent(/^2 selected$/))
  expect(screen.getByTestId('std-filter-floor')).toHaveAccessibleName('Floor: 2 selected')
})

test('Ticking every floor at once, then unticking Ground, shows every row not on Ground', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  const list = openBox('floor')
  fireEvent.click(within(list).getByRole('button', { name: 'Select all' }))
  expect(ticked(list)).toEqual(FLOORS)
  tick(list, 'Ground')
  await waitFor(() => expect(codes()).toEqual(['R3', 'R4', 'R5', 'R6']))
  expect(chips()).toEqual(['Floor in First Floor, Second Floor, Third Floor×'])
})

test('Clear unticks every choice and removes the filter', async ({ admin }) => {
  await seed(admin)
  await openList(admin, [['floor', 'in', ['Ground', 'First Floor']]])
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2', 'R3', 'R4']))
  const list = openBox('floor')
  fireEvent.click(within(list).getByRole('button', { name: 'Clear' }))
  expect(ticked(list)).toEqual([])
  await waitFor(() => expect(codes()).toHaveLength(6))
  expect(chips()).toEqual([])
})

const RACKS = ['Shoe Rack', 'Saree Rack', 'Rack Ends']

test('Searching Section\'s 12 choices for "rack", then ticking every one found, ticks only the rack sections', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  const list = openBox('section')
  fireEvent.change(within(list).getByRole('searchbox', { name: 'Search Section choices' }), { target: { value: 'rack' } })
  fireEvent.click(within(list).getByRole('button', { name: 'Select all' }))
  await waitFor(() => expect(codes()).toEqual(['R2', 'R3', 'R5']))
  expect(chips()).toEqual(['Section in Shoe Rack, Saree Rack, Rack Ends×'])
  expect(ticked(list)).toEqual(RACKS)
})

test('A list of 8 choices has no search box, and a list of 9 has one', async ({ admin }) => {
  const names = (n: number) => Array.from({ length: n }, (_, i) => `C${i + 1}`).join('\n')
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'code', column_type: 'Data', label: 'Code', in_list_view: true },
      { column_name: 'eight', column_type: 'Choice', label: 'Eight', choices: names(8), in_list_view: true },
      { column_name: 'nine', column_type: 'Choice', label: 'Nine', choices: names(9), in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: T, row: { code: 'R1', eight: 'C1', nine: 'C1' } })
  await openList(admin)
  expect(within(openBox('eight')).queryByRole('searchbox')).not.toBeInTheDocument()
  expect(within(openBox('nine')).getByRole('searchbox', { name: 'Search Nine choices' })).toBeInTheDocument()
})

test('Ticks hidden by a search stay on', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  const list = openBox('section')
  tick(list, 'Sarees')
  await waitFor(() => expect(codes()).toEqual(['R1']))
  const search = within(list).getByRole('searchbox', { name: 'Search Section choices' })
  fireEvent.change(search, { target: { value: 'rack' } })
  expect(within(list).queryByRole('checkbox', { name: 'Sarees' })).not.toBeInTheDocument()
  tick(list, 'Shoe Rack')
  await waitFor(() => expect(codes()).toEqual(['R1', 'R2']))
  fireEvent.change(search, { target: { value: '' } })
  expect(ticked(list)).toEqual(['Sarees', 'Shoe Rack'])
})
