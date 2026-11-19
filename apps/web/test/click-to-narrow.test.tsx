// #1289 option C, Click To Narrow (board A): the panel left of every list.
// Made-up store layout: Region ← Store ← Section → Floor.
import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { decodePath } from '../src/lib/nav-path'

configure({ asyncUtilTimeout: 10_000 })
type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent

const REGION = 'Nw Region'
const STORE = 'Nw Store'
const FLOOR = 'Nw Floor'
const SECTION = 'Nw Section'

async function seed(admin: Admin, extraSections = 0) {
  const title = { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true }
  const ref = (column_name: string, label: string, reference_table: string) => ({ column_name, column_type: 'Reference', label, reference_table, in_list_view: true })
  await admin.post('/api/table_def', { name: REGION, title_column: 'title', columns: [title] })
  await admin.post('/api/table_def', { name: STORE, title_column: 'title', columns: [title, ref('region', 'Region', REGION)] })
  await admin.post('/api/table_def', { name: FLOOR, title_column: 'title', columns: [title] })
  await admin.post('/api/table_def', { name: SECTION, title_column: 'title', columns: [title, ref('store', 'Store', STORE), ref('floor', 'Floor', FLOOR)] })
  const insert = async (table: string, row: Record<string, unknown>) => (await admin.post<{ row_id: string }>('/api/save_row', { table, row })).row_id
  const coastal = await insert(REGION, { title: 'Coastal' })
  const inland = await insert(REGION, { title: 'Inland' })
  const bayside = await insert(STORE, { title: 'Bayside', region: coastal })
  const northgate = await insert(STORE, { title: 'Northgate', region: inland })
  const ground = await insert(FLOOR, { title: 'Ground Floor' })
  const first = await insert(FLOOR, { title: 'First Floor' })
  await insert(SECTION, { title: 'Ethnic Wear', store: bayside, floor: first })
  await insert(SECTION, { title: 'Night Wear', store: bayside, floor: first })
  await insert(SECTION, { title: 'Grocery', store: bayside, floor: ground })
  await insert(SECTION, { title: 'Ladies Ethnic', store: northgate, floor: first })
  await insert(SECTION, { title: 'Pop Up', floor: ground })
  for (let i = 1; i <= extraSections; i++) await insert(SECTION, { title: `Kiosk ${String(i).padStart(2, '0')}`, store: northgate })
  return { bayside, northgate }
}

const listPath = (table: string) => `/featherbase/admin/table/${tableSlug(table)}?filters=${enc('[]')}`
const rowTitles = () => [...document.querySelectorAll('tbody [data-title-cell]')].map((c) => c.textContent ?? '')
const panel = () => screen.getByRole('complementary', { name: 'Click To Narrow' })
const narrowList = (name: string) => within(panel()).getByRole('region', { name })
const value = (list: string, name: string) => within(narrowList(list)).getByRole('button', { name: new RegExp(`^${name} \\d+$`) })
const walk = (r: { router: unknown }) => decodePath((r.router as { state: { location: { search: { path?: unknown } } } }).state.location.search.path)!
const addressFilters = (r: { router: unknown }) => {
  const search = (r.router as { state: { location: { search: { path?: unknown } } } }).state.location.search
  const path = decodePath(search.path)!
  return path.steps[path.at].filters
}

test('every list shows a panel with one list per table its rows reach, each value with its count', async ({ admin }) => {
  const ids = await seed(admin)
  await renderApp(listPath(SECTION), admin)
  await screen.findByText('Ethnic Wear')
  await waitFor(() => expect(value(STORE, 'Bayside')).toHaveTextContent('3'))
  expect(within(narrowList(STORE)).getByTestId('narrow-note')).toHaveTextContent('3 of 3')
  // A record value is a pick control and a real link underneath: Cmd/Ctrl-click opens the store.
  expect(value(STORE, 'Bayside')).toHaveAttribute('href', `/featherbase/admin/table/${tableSlug(STORE)}/row/${ids.bayside}`)
  expect(value(FLOOR, 'First Floor')).toHaveTextContent('3')
  // Two links away, through Store, and named by its table only.
  expect(within(narrowList(REGION)).getByText(`through ${STORE}`)).toBeInTheDocument()
  await waitFor(() => expect(value(REGION, 'Coastal')).toHaveTextContent('3'))
  // The section with no store is "Not linked to any Store", in red.
  expect(value(STORE, `Not linked to any ${STORE}`)).toHaveTextContent('1')
})

test('a click narrows the list and every other list; ruled-out values stay, grey, at 0', async ({ admin }) => {
  await seed(admin)
  const r = await renderApp(listPath(SECTION), admin)
  await waitFor(() => expect(value(STORE, 'Northgate')).toHaveTextContent('1'))
  await userEvent.click(value(STORE, 'Northgate'))
  await waitFor(() => expect(rowTitles()).toEqual(['Ladies Ethnic']))
  expect(addressFilters(r)).toEqual([['store', 'related', { table: STORE, filters: [['row_id', 'in', [expect.any(String)]]] }]])
  expect(value(STORE, 'Northgate')).toHaveAttribute('aria-pressed', 'true')
  // The picked list still shows what else is possible.
  expect(value(STORE, 'Bayside')).toHaveTextContent('3')
  await waitFor(() => expect(value(FLOOR, 'Ground Floor')).toHaveTextContent('0'))
  expect(value(FLOOR, 'Ground Floor')).toHaveAttribute('data-state', 'ruled-out')
  expect(within(narrowList(FLOOR)).getByTestId('narrow-note')).toHaveTextContent('1 of 2')
  // The pick reads as a green chip, removable.
  const chip = screen.getByTestId('filter-chip')
  expect(chip).toHaveTextContent(`${STORE}: Northgate`)
  expect(chip).toHaveAttribute('data-tone', 'picked')
  await userEvent.click(within(chip).getByRole('button', { name: /Remove/ }))
  await waitFor(() => expect(rowTitles()).toHaveLength(5))
})

test('a long list shows its top 6, Show all in a scroll box, and Find in its table', async ({ admin }) => {
  await seed(admin, 9)
  await renderApp(listPath(SECTION), admin)
  await waitFor(() => expect(within(narrowList(SECTION)).getAllByRole('button', { pressed: false })).toHaveLength(6))
  await userEvent.click(within(narrowList(SECTION)).getByRole('button', { name: 'Show all 14' }))
  expect(within(narrowList(SECTION)).getByTestId('narrow-scroll')).toBeInTheDocument()
  expect(within(narrowList(SECTION)).getAllByRole('button', { pressed: false })).toHaveLength(14)
  await userEvent.type(within(narrowList(SECTION)).getByRole('searchbox', { name: `Find in ${SECTION}` }), 'Kiosk 0')
  await waitFor(() => expect(within(narrowList(SECTION)).getAllByRole('button', { pressed: false })).toHaveLength(9))
})

test('the panel can be hidden, and stays hidden for this person and Table', async ({ admin }) => {
  await seed(admin)
  const first = await renderApp(listPath(SECTION), admin)
  await screen.findByRole('complementary', { name: 'Click To Narrow' })
  await userEvent.click(screen.getByRole('button', { name: 'Click To Narrow' }))
  expect(screen.queryByRole('complementary', { name: 'Click To Narrow' })).toBeNull()
  first.unmount()
  await renderApp(listPath(SECTION), admin)
  await screen.findByText('Ethnic Wear')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Click To Narrow' })).toHaveAttribute('aria-pressed', 'false'))
  expect(screen.queryByRole('complementary', { name: 'Click To Narrow' })).toBeNull()
})

test('ticks narrow the list in place: the walk gains no step per click', async ({ admin }) => {
  await seed(admin)
  const r = await renderApp(listPath(SECTION), admin)
  await waitFor(() => expect(value(STORE, 'Bayside')).toHaveTextContent('3'))
  await userEvent.click(value(STORE, 'Bayside'))
  await waitFor(() => expect(rowTitles()).toHaveLength(3))
  await userEvent.click(value(FLOOR, 'First Floor'))
  await waitFor(() => expect(rowTitles()).toHaveLength(2))
  await userEvent.click(value(STORE, 'Bayside'))
  await waitFor(() => expect(rowTitles()).toHaveLength(3))
  expect(walk(r).steps).toHaveLength(1)
})

test('each picked value is its own green chip; removing one keeps the others', async ({ admin }) => {
  await seed(admin)
  await renderApp(listPath(SECTION), admin)
  await waitFor(() => expect(value(STORE, 'Bayside')).toHaveTextContent('3'))
  await userEvent.click(value(STORE, 'Bayside'))
  await userEvent.click(value(STORE, 'Northgate'))
  await waitFor(() => expect(rowTitles()).toHaveLength(4))
  const chips = await screen.findAllByTestId('filter-chip')
  expect(chips.map((c) => c.textContent?.replace('✕', ''))).toEqual([`${STORE}: Bayside`, `${STORE}: Northgate`])
  await userEvent.click(within(chips[0]).getByRole('button', { name: /Remove/ }))
  await waitFor(() => expect(rowTitles()).toEqual(['Ladies Ethnic']))
  expect(screen.getAllByTestId('filter-chip').map((c) => c.textContent?.replace('✕', ''))).toEqual([`${STORE}: Northgate`])
})
