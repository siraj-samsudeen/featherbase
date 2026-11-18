// #1016, #1017 (spec: list-view "Narrow the list with filters", "A list's
// controls leave the room to its rows"): password managers leave filter boxes
// alone, and the Add filter row waits until it is asked for.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { PLANT, SITE, seedSites } from './relational-fixture'
import { createUserWithRole } from 'server/test/fixtures'
import { UNSEEN_ROW } from '../src/lib/relations'

configure({ asyncUtilTimeout: 10_000 })

function expectLeftAlone(box: HTMLElement) {
  expect(box).toHaveAttribute('autocomplete', 'off')
  for (const manager of ['data-1p-ignore', 'data-lpignore', 'data-bwignore']) expect(box).toHaveAttribute(manager, 'true')
  expect(box).toHaveAttribute('data-form-type', 'other')
}

const addFilter = () => screen.findByRole('button', { name: 'Add filter', expanded: false })

test('the search box and link filter boxes tell password managers to leave them alone', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  expectLeftAlone(await screen.findByTestId('list-search'))
  expectLeftAlone(await screen.findByTestId('std-filter-region'))
  fireEvent.click(await addFilter())
  expectLeftAlone(await screen.findByTestId('filter-value'))
})

test('the Add filter row is closed until asked for, and closes again', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  fireEvent.click(await addFilter())
  expect(await screen.findByTestId('filter-field')).toBeInTheDocument()
  expect(await screen.findByTestId('filter-value')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('filter-toggle'))
  await waitFor(() => expect(screen.queryByTestId('filter-field')).not.toBeInTheDocument())
})

// #1289: a filter with no box of its own is a chip, its date as the cells show dates.
test('filters already applied stay visible with the Add filter row closed', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(`${tableHref(SITE)}?filters=${encodeURIComponent(JSON.stringify([['opened_on', '>', '2020-01-05']]))}`, admin)
  await addFilter()
  const chip = await screen.findByTestId('filter-chip')
  expect(screen.queryByTestId('filter-field')).not.toBeInTheDocument()
  expect(chip).toHaveTextContent('Opened on > 05-Jan-2020')
  expect(within(chip).getByRole('button', { name: /^Remove .+ filter$/ })).toBeInTheDocument()
})

// #1289: the column Search looks in has no box of its own: the search box shows that filter.
test("the title column has no field box beside the search box, so a search shows once", async ({ admin }) => {
  await seedSites(admin)
  await renderApp(`${tableHref(SITE)}?filters=${encodeURIComponent(JSON.stringify([['site_name', 'like', '%Enc%']]))}`, admin)
  expect(await screen.findByTestId('list-search')).toHaveValue('Enc')
  expect(screen.queryByTestId('std-filter-site_name')).not.toBeInTheDocument()
  expect(screen.queryAllByTestId('filter-chip')).toHaveLength(0)
})

// #1289: a filter typed into a field box is shown by that box alone; the box's own ✕ takes it off.
test("a filter typed into a field box shows in the box, not as a chip, and the box's ✕ takes it off", async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(PLANT), admin)
  const box = await screen.findByTestId('std-filter-format')
  fireEvent.change(box, { target: { value: 'Super' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  const clear = await screen.findByRole('button', { name: 'Clear the Format filter' })
  expect(screen.queryAllByTestId('filter-chip')).toHaveLength(0)
  fireEvent.click(clear)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear the Format filter' })).not.toBeInTheDocument())
  expect(box).toHaveValue('')
})

// #1289: a chip's value reads as a person reads it: a Check is Yes or No, never 1 or 0.
test('a Check filter reads Yes or No on its chip', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Lfb Flags', id_pattern: 'prompt', title_column: 'flag_name', columns: [
    { column_name: 'flag_name', column_type: 'Data', label: 'Flag', in_list_view: true },
    { column_name: 'enabled', column_type: 'Check', label: 'Enabled', in_list_view: true },
  ] })
  await renderApp(`${tableHref('Lfb Flags')}?filters=${encodeURIComponent(JSON.stringify([['enabled', '=', '1'], ['enabled', '!=', 0]]))}`, admin)
  await waitFor(() => expect(screen.getAllByTestId('filter-chip').map((c) => c.textContent?.replace('✕', ''))).toEqual(['Enabled: Yes', 'Enabled != No']))
  // Two filters on: one control takes them all off.
  expect(screen.getByTestId('filter-clear-all')).toHaveTextContent('Clear All Filters')
})

// #1289 (verifier): a record named in a chip is a link that opens it, as every record shown is.
test("a chip names a linked record as a link to it", async ({ admin }) => {
  await seedSites(admin)
  await renderApp(`${tableHref(SITE)}?filters=${encodeURIComponent(JSON.stringify([['region', '!=', 'KL']]))}`, admin)
  const chip = await screen.findByTestId('filter-chip')
  const link = await within(chip).findByRole('link', { name: 'Kerala' })
  expect(link.getAttribute('href')).toContain('/row/KL')
})

// #1289: a record the viewer may not open is named in plain words, never a link and never its id.
test("a chip names a linked record the viewer may not open in plain words, with no link", async ({ admin, createUser }) => {
  await seedSites(admin)
  const user = await createUserWithRole(admin, createUser, { role: 'Lfb Site Reader', table: SITE, tier: 'basic', can_read: true })
  await renderApp(`${tableHref(SITE)}?filters=${encodeURIComponent(JSON.stringify([['region', '!=', 'KL']]))}`, user)
  const chip = await screen.findByTestId('filter-chip')
  await waitFor(() => expect(chip).toHaveTextContent(UNSEEN_ROW))
  expect(within(chip).queryByRole('link')).not.toBeInTheDocument()
  expect(chip).not.toHaveTextContent('KL')
})

// #1289: a filter on many values reads each as the cells would.
test('a Check filter on several values reads each as Yes or No', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Lfb Many Flags', id_pattern: 'prompt', title_column: 'flag_name', columns: [
    { column_name: 'flag_name', column_type: 'Data', label: 'Flag', in_list_view: true },
    { column_name: 'enabled', column_type: 'Check', label: 'Enabled', in_list_view: true },
  ] })
  await renderApp(`${tableHref('Lfb Many Flags')}?filters=${encodeURIComponent(JSON.stringify([['enabled', 'in', [1, 0]]]))}`, admin)
  await waitFor(() => expect(screen.getByTestId('filter-chip').textContent?.replace('✕', '')).toBe('Enabled in Yes, No'))
})
