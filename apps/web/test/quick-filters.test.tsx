// #742: the quick filter boxes above a list follow the columns one person
// sees, against the real in-process server.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { NARROW_QUERY } from '../src/components/ui/DataList'
import { recordAction } from '../src/lib/recents'

afterEach(() => {
  vi.restoreAllMocks()
})

// jsdom has no matchMedia; a phone is the narrow query matching.
function onPhone() {
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: q === NARROW_QUERY, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList)
}

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
  [...screen.getByTestId('standard-filters').querySelectorAll('[data-testid^="std-filter-"]:not([data-testid="std-filter-more"])')].map((e) =>
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

test('Picking First narrows the rows and shows as in use; picking All brings them back', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  await waitFor(() => expect(sections()).toHaveLength(3))
  fireEvent.change(screen.getByTestId('std-filter-floor'), { target: { value: 'First' } })
  await waitFor(() => expect(sections()).toEqual(['Shirts']))
  expect(screen.getByTestId('filter-chip')).toHaveTextContent('floor = First')
  fireEvent.change(screen.getByTestId('std-filter-floor'), { target: { value: '' } })
  await waitFor(() => expect(sections()).toHaveLength(3))
  expect(screen.queryByTestId('filter-chip')).not.toBeInTheDocument()
})

test('Typing "asha" in the Owner box finds rows containing asha', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  await waitFor(() => expect(sections()).toHaveLength(3))
  fireEvent.change(screen.getByTestId('std-filter-owner_name'), { target: { value: 'asha' } })
  fireEvent.keyDown(screen.getByTestId('std-filter-owner_name'), { key: 'Enter' })
  await waitFor(() => expect(sections()).toEqual(['Sarees']))
})

async function seedActive(admin: Admin) {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'section', column_type: 'Data', label: 'Section', in_list_view: true },
      { column_name: 'active', column_type: 'Check', label: 'Active', in_list_view: true },
    ],
  })
  for (const [section, active] of [['Sarees', true], ['Shawls', true], ['Shirts', false]])
    await admin.post('/api/save_row', { table: T, row: { section, active } })
}

test('The Active box offers All, Yes and No, and each finds the right rows', async ({ admin }) => {
  await seedActive(admin)
  await openList(admin)
  await waitFor(() => expect(sections()).toHaveLength(3))
  const box = screen.getByTestId('std-filter-active')
  expect([...box.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['All', 'Yes', 'No'])

  fireEvent.change(box, { target: { value: 'Yes' } })
  await waitFor(() => expect(sections().sort()).toEqual(['Sarees', 'Shawls']))
  fireEvent.change(screen.getByTestId('std-filter-active'), { target: { value: 'No' } })
  await waitFor(() => expect(sections()).toEqual(['Shirts']))
  fireEvent.change(screen.getByTestId('std-filter-active'), { target: { value: '' } })
  await waitFor(() => expect(sections()).toHaveLength(3))
})

test('A Yes/No box stores the word Yes or No in the page address, as Choice does', async ({ admin }) => {
  await seedActive(admin)
  await openList(admin, `?filters=${enc(JSON.stringify([['active', '=', 'No']]))}`)
  await waitFor(() => expect(sections()).toEqual(['Shirts']))
  expect(screen.getByTestId('std-filter-active')).toHaveValue('No')
  expect(screen.getByTestId('filter-chip')).toHaveTextContent('active = No')
})

const options = (testId: string) =>
  [...screen.getByTestId(testId).querySelectorAll('option')].map((o) => o.getAttribute('value'))

test('Adding Floor = Ground narrows the rows, and removing it brings them all back', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  await waitFor(() => expect(sections()).toHaveLength(3))
  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: 'floor' } })
  fireEvent.change(screen.getByTestId('filter-value'), { target: { value: 'Ground' } })
  fireEvent.click(screen.getByTestId('filter-add'))
  await waitFor(() => expect(sections().sort()).toEqual(['Sarees', 'Shawls']))
  const chip = screen.getByTestId('filter-chip')
  expect(chip).toHaveTextContent('floor = Ground')
  fireEvent.click(within(chip).getByLabelText('Remove filter'))
  await waitFor(() => expect(sections()).toHaveLength(3))
})

test('Adding a filter on Floor offers its choices, without typing', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: 'floor' } })
  expect(screen.getByTestId('filter-value').tagName).toBe('SELECT')
  expect(options('filter-value')).toEqual(['', 'Ground', 'First'])
})

test('An added filter on Active finds the active rows, and its chip reads Yes', async ({ admin }) => {
  await seedActive(admin)
  await openList(admin)
  await waitFor(() => expect(sections()).toHaveLength(3))
  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: 'active' } })
  expect(options('filter-value')).toEqual(['', 'Yes', 'No'])
  fireEvent.change(screen.getByTestId('filter-value'), { target: { value: 'Yes' } })
  fireEvent.click(screen.getByTestId('filter-add'))
  await waitFor(() => expect(sections().sort()).toEqual(['Sarees', 'Shawls']))
  expect(screen.getByTestId('filter-chip')).toHaveTextContent('active = Yes')
})

test('Choice and Yes/No columns offer only = and !=, and moving to one resets another operator to =', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: 'section' } })
  fireEvent.change(screen.getByTestId('filter-op'), { target: { value: 'like' } })
  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: 'floor' } })
  expect(options('filter-op')).toEqual(['=', '!='])
  expect(screen.getByTestId('filter-op')).toHaveValue('=')
})

test('A text column keeps its typed value and every operator', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: 'section' } })
  expect(screen.getByTestId('filter-value').tagName).toBe('INPUT')
  expect(options('filter-op')).toEqual(['=', '!=', 'like', '>', '<', '>=', '<='])
})

test("The report's filter bar also offers the dropdowns", async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc(T)}/view/report`, admin)
  await screen.findByTestId('report-view', {}, { timeout: 8000 })
  fireEvent.change(screen.getByTestId('filter-field'), { target: { value: 'floor' } })
  expect(options('filter-value')).toEqual(['', 'Ground', 'First'])
})

const EIGHT = ['store', 'lob', 'main_category', 'category', 'sub_category', 'section', 'floor_name', 'owner_name']

async function seedEight(admin: Admin) {
  await admin.post('/api/table_def', {
    name: T,
    columns: EIGHT.map((c) => ({ column_name: c, column_type: 'Data', label: c, in_list_view: true })),
  })
  await admin.post('/api/save_row', { table: T, row: Object.fromEntries(EIGHT.map((c) => [c, `${c}-1`])) })
}

test('Eight possible boxes show six and say 2 more, and asking shows all eight without leaving the list', async ({ admin }) => {
  await seedEight(admin)
  await openList(admin)
  expect(boxes()).toEqual(EIGHT.slice(0, 6))
  const more = screen.getByTestId('std-filter-more')
  expect(more).toHaveTextContent('+2 more')
  fireEvent.click(more)
  expect(boxes()).toEqual(EIGHT)
  expect(screen.getByTestId('std-filter-more')).toHaveTextContent('Show fewer')
})

test('A link with a value in the eighth box shows six plus the eighth, and says 1 more', async ({ admin }) => {
  await seedEight(admin)
  await openList(admin, `?filters=${enc(JSON.stringify([['owner_name', 'like', '%owner%']]))}`)
  expect(boxes()).toEqual([...EIGHT.slice(0, 6), 'owner_name'])
  expect(screen.getByTestId('std-filter-owner_name')).toHaveValue('owner')
  expect(screen.getByTestId('std-filter-more')).toHaveTextContent('+1 more')
})

test('After opening, "Show fewer" folds the extra boxes away again, keeping a box that holds a value', async ({ admin }) => {
  await seedEight(admin)
  await openList(admin, `?filters=${enc(JSON.stringify([['owner_name', 'like', '%owner%']]))}`)
  fireEvent.click(screen.getByTestId('std-filter-more'))
  expect(boxes()).toEqual(EIGHT)
  const fewer = screen.getByTestId('std-filter-more')
  expect(fewer).toHaveTextContent('Show fewer')
  fireEvent.click(fewer)
  expect(boxes()).toEqual([...EIGHT.slice(0, 6), 'owner_name'])
  expect(screen.getByTestId('std-filter-more')).toHaveTextContent('+1 more')
})

test('Six or fewer possible boxes show no "more" control', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  expect(boxes()).toHaveLength(3)
  expect(screen.queryByTestId('std-filter-more')).not.toBeInTheDocument()
})

const TWO_IN_USE = JSON.stringify([['floor', '=', 'Ground'], ['owner_name', 'like', '%asha%']])

test('On a phone, the folded filters say 2 filters are in use', async ({ admin }) => {
  onPhone()
  await seed(admin)
  await openList(admin, `?filters=${enc(TWO_IN_USE)}`)
  expect(screen.getByTestId('filters-toggle')).toHaveTextContent('Filters (2)')
  expect(screen.getByTestId('filters-toggle')).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTestId('standard-filters')).not.toBeInTheDocument()
  expect(screen.queryByTestId('filter-field')).not.toBeInTheDocument()
})

test('On a phone, opening the filters shows up to four quick filters, says how many more, and lets the user add one', async ({ admin }) => {
  onPhone()
  await seedEight(admin)
  await openList(admin)
  expect(screen.getByTestId('filters-toggle')).toHaveTextContent('Filters')
  fireEvent.click(screen.getByTestId('filters-toggle'))
  expect(boxes()).toEqual(EIGHT.slice(0, 4))
  expect(screen.getByTestId('std-filter-more')).toHaveTextContent('+4 more')
  fireEvent.click(screen.getByTestId('std-filter-more'))
  expect(boxes()).toEqual(EIGHT)
  expect(screen.getByTestId('filter-field')).toBeInTheDocument()
})

test('On a phone, Recent folds behind the Filters button; Save view stays showing', async ({ admin }) => {
  onPhone()
  await seed(admin)
  recordAction('Administrator', { kind: 'row', key: `row:${T}/r-1`, label: 'r-1', sub: T, path: `/featherbase/admin/${enc(T)}/r-1` })
  // Save view shows once a filter is on.
  await openList(admin, `?filters=${enc(JSON.stringify([['floor', '=', 'Ground']]))}`)
  expect(await screen.findByTestId('saved-views-bar')).toBeInTheDocument()
  expect(screen.queryByTestId('recent-strip')).not.toBeInTheDocument()
  fireEvent.click(screen.getByTestId('filters-toggle'))
  expect(screen.getByTestId('recent-strip')).toBeInTheDocument()
})

test('The Filters button shows an arrow that turns over when opened', async ({ admin }) => {
  onPhone()
  await seed(admin)
  await openList(admin)
  const toggle = screen.getByTestId('filters-toggle')
  const arrow = toggle.querySelector('[data-chevron]')!
  expect(arrow).not.toHaveClass('rotate-180')
  fireEvent.click(toggle)
  expect(screen.getByTestId('filters-toggle').querySelector('[data-chevron]')).toHaveClass('rotate-180')
})

test('On a phone, only the count shows while folded; opening shows the filters in use, each removable', async ({ admin }) => {
  onPhone()
  await seed(admin)
  await openList(admin, `?filters=${enc(TWO_IN_USE)}`)
  expect(screen.queryByTestId('filter-chip')).not.toBeInTheDocument()
  fireEvent.click(screen.getByTestId('filters-toggle'))
  const chips = screen.getAllByTestId('filter-chip')
  expect(chips).toHaveLength(2)
  fireEvent.click(within(chips[0]).getByLabelText('Remove filter'))
  await waitFor(() => expect(screen.getByTestId('filters-toggle')).toHaveTextContent('Filters (1)'))
})

test('On a desktop, the filters show with no Filters button', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  expect(screen.queryByTestId('filters-toggle')).not.toBeInTheDocument()
  expect(screen.getByTestId('standard-filters')).toBeInTheDocument()
})

test('A hand-edited link shows its Yes/No value in the box: true as Yes, and a value it cannot read as itself', async ({ admin }) => {
  await seedActive(admin)
  await openList(admin, `?filters=${enc(JSON.stringify([['active', '=', 'TRUE']]))}`)
  await waitFor(() => expect(sections()).toHaveLength(2))
  expect(screen.getByTestId('std-filter-active')).toHaveValue('Yes')
})

test('A hand-edited link with a value the box cannot read shows that value, not All', async ({ admin }) => {
  await seedActive(admin)
  await openList(admin, `?filters=${enc(JSON.stringify([['active', '=', 'maybe']]))}`)
  expect(await screen.findByTestId('std-filter-active')).toHaveValue('maybe')
})

test('Row ID gets no box and takes none of the six places, and can still get an added filter', async ({ admin }) => {
  await seed(admin)
  await openList(admin)
  expect(screen.queryByTestId('std-filter-row_id')).not.toBeInTheDocument()
  expect(boxes()[0]).toBe('section')
  expect(within(screen.getByTestId('filter-field')).getByRole('option', { name: 'Row ID' })).toBeInTheDocument()
})
