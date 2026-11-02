// #742: the quick filter boxes above a list follow the columns one person
// sees, against the real in-process server.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]

const T = 'Section Mapping'
const enc = encodeURIComponent

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'section', column_type: 'Data', label: 'Section', in_list_view: true },
      { column_name: 'remarks', column_type: 'Data', label: 'Remarks' },
      { column_name: 'floor', column_type: 'Choice', label: 'Floor', choices: 'Ground\nFirst', in_list_view: true },
      { column_name: 'audited_on', column_type: 'Date', label: 'Audited On', in_list_view: true },
      { column_name: 'owner_name', column_type: 'Data', label: 'Owner', in_list_view: true },
    ],
  })
  for (const [section, floor, owner_name] of [
    ['Sarees', 'Ground', 'Asha'],
    ['Shawls', 'Ground', 'Ravi'],
    ['Shirts', 'First', 'Ashok'],
  ])
    await admin.post('/api/save_row', { table: T, row: { section, floor, owner_name } })
}

async function openList(admin: Admin, search = '') {
  await renderApp(`/featherbase/admin/${enc(T)}${search}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
  await screen.findByTestId('list-rows')
}

const boxes = () =>
  [...screen.getByTestId('standard-filters').querySelectorAll('[data-testid^="std-filter-"]')].map((e) =>
    e.getAttribute('data-testid')!.replace('std-filter-', ''),
  )
const sections = () =>
  [...screen.getByTestId('list-rows').querySelectorAll('[data-testid="cell-section"]')].map((e) => e.textContent ?? '')

// A column switch saves in the background; wait for it, so no request outlives
// the test's sandbox.
async function switchColumn(admin: Admin, column: string, want: { shownCols?: string[]; hiddenCols?: string[] }) {
  await waitFor(() => expect(sections().length).toBeGreaterThan(0))
  if (!screen.queryByTestId('list-columns-popup')) fireEvent.click(screen.getByTestId('list-columns'))
  fireEvent.click(await screen.findByTestId(`list-col-toggle-${column}`))
  await waitFor(async () => {
    const stored = await admin.get<{ settings: Record<string, unknown> | null }>(`/api/user_settings/${enc(T)}`)
    expect(stored.settings).toMatchObject(want)
  })
}

test('Remarks gets a quick filter when it is switched on, in its place among the columns', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  expect(boxes()).toEqual(['section', 'floor', 'owner_name'])
  await switchColumn(admin, 'remarks', { shownCols: ['remarks'] })
  await waitFor(() => expect(boxes()).toEqual(['section', 'remarks', 'floor', 'owner_name']))
})

test("Floor's quick filter goes when Floor is switched off", async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  await switchColumn(admin, 'floor', { hiddenCols: ['floor'] })
  await waitFor(() => expect(boxes()).toEqual(['section', 'owner_name']))
})

test('A filter on a hidden column stays on, shows as in use, and can be removed', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  await waitFor(() => expect(sections()).toHaveLength(3))
  fireEvent.change(screen.getByTestId('std-filter-floor'), { target: { value: 'Ground' } })
  await waitFor(() => expect(sections().sort()).toEqual(['Sarees', 'Shawls']))

  await switchColumn(admin, 'floor', { hiddenCols: ['floor'] })
  await waitFor(() => expect(screen.queryByTestId('std-filter-floor')).not.toBeInTheDocument())
  expect(sections().sort()).toEqual(['Sarees', 'Shawls'])
  const chip = screen.getByTestId('filter-chip')
  expect(chip).toHaveTextContent('floor = Ground')

  fireEvent.click(within(chip).getByLabelText('Remove filter'))
  await waitFor(() => expect(sections()).toHaveLength(3))
})

test('A date column has no quick filter, and can still get an added filter', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  expect(screen.queryByTestId('std-filter-audited_on')).not.toBeInTheDocument()
  expect(within(screen.getByTestId('filter-field')).getByRole('option', { name: 'Audited On' })).toBeInTheDocument()
})

test('Number, money, long text, file and JSON columns get no box', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'section', column_type: 'Data', label: 'Section', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
      { column_name: 'ratio', column_type: 'Float', label: 'Ratio', in_list_view: true },
      { column_name: 'price', column_type: 'Currency', label: 'Price', in_list_view: true },
      { column_name: 'notes', column_type: 'Text', label: 'Notes', in_list_view: true },
      { column_name: 'photo', column_type: 'Attach', label: 'Photo', in_list_view: true },
      { column_name: 'extra', column_type: 'JSON', label: 'Extra', in_list_view: true },
    ],
  })
  await openList(admin)
  expect(boxes()).toEqual(['section'])
})

test('Row ID gets no box and takes none of the six places, and can still get an added filter', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  expect(screen.queryByTestId('std-filter-row_id')).not.toBeInTheDocument()
  expect(boxes()[0]).toBe('section')
  expect(within(screen.getByTestId('filter-field')).getByRole('option', { name: 'Row ID' })).toBeInTheDocument()
})
