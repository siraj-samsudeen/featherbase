// #792 (specs: list-view, search-and-explore): rows read by their name, not
// their id — a list led by the title column, link cells as titles, filter
// words and Recent naming the picked row, and the map's row lists. Made-up rows.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { recordAction } from '../src/lib/recents'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })
const enc = encodeURIComponent
const CUSTOMER = 'Rn Customer'
const ORDER = 'Rn Order'

async function seed(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', {
    name: CUSTOMER, id_pattern: 'prompt', title_column: 'customer_name',
    columns: [
      { column_name: 'customer_name', label: 'Customer Name', column_type: 'Data', in_list_view: true },
      { column_name: 'city', label: 'City', column_type: 'Data', in_list_view: true },
    ],
  })
  await admin.post('/api/table_def', {
    name: ORDER, id_pattern: 'prompt',
    columns: [
      { column_name: 'item', label: 'Item', column_type: 'Data', in_list_view: true },
      { column_name: 'customer', label: 'Customer', column_type: 'Reference', reference_table: CUSTOMER, in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: CUSTOMER, row: { row_id: 'cust-1', customer_name: 'Globex Ltd', city: 'Springfield' } })
  await admin.post('/api/save_row', { table: CUSTOMER, row: { row_id: 'cust-3', customer_name: '', city: '' } })
  await admin.post('/api/save_row', { table: ORDER, row: { row_id: 'ord-1', item: 'Widgets', customer: 'cust-1' } })
}

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[↑↓]/g, '').trim())

test('a titled list leads with the title as the link, with no Row ID', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc(CUSTOMER)}`, admin)
  const link = await screen.findByRole('link', { name: 'Globex Ltd' })
  expect(link.getAttribute('href')).toContain('/cust-1')
  expect(headers()).not.toContain('Row ID')
  expect(headers().find((h) => h && h !== '')).toBe('Customer Name')
})

test('a blank title leads with the row id, never a blank', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc(CUSTOMER)}`, admin)
  await waitFor(() => {
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.endsWith('/cust-3'))
    expect(links.some((a) => a.textContent?.trim() === 'cust-3')).toBe(true)
  })
})

test('the columns menu keeps the title always on, in place of Row ID', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc(CUSTOMER)}`, admin)
  await screen.findByRole('link', { name: 'Globex Ltd' })
  fireEvent.click(screen.getByTestId('list-columns'))
  const menu = await screen.findByTestId('list-columns-popup')
  expect(within(menu).getByRole('checkbox', { name: 'Customer Name' })).toBeDisabled()
  expect(within(menu).queryByRole('checkbox', { name: 'Row ID' })).toBeNull()
  expect(within(menu).getByRole('checkbox', { name: 'City' })).toBeEnabled()
})

test('a link cell reads as the linked row\'s title and opens it; an untitled list keeps Row ID', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc(ORDER)}`, admin)
  const cell = (await screen.findAllByTestId('cell-customer'))[0]
  await waitFor(() => expect(cell).toHaveTextContent('Globex Ltd'))
  expect(within(cell).getByRole('link').getAttribute('href')).toContain(`/${enc(CUSTOMER)}/cust-1`)
  expect(headers()).toContain('Row ID')
})

test('a link filter names its column and the picked row, in use and in Recent', async ({ admin }) => {
  await seed(admin)
  const filters = JSON.stringify([['customer', '=', 'cust-1']])
  const path = `/featherbase/admin/${enc(ORDER)}`
  recordAction('Administrator', {
    kind: 'list', key: `list:${ORDER}?${filters}`, label: ORDER, sub: 'customer = cust-1', path: `${path}?filters=${enc(filters)}`,
  }, Date.now() - 1000)
  await renderApp(`${path}?filters=${enc(filters)}`, admin)
  await waitFor(() => expect(screen.getByTestId('filter-chip')).toHaveTextContent('Customer = Globex Ltd'))
  await waitFor(() => expect(screen.getByTestId('recent-strip-view')).toHaveTextContent('Customer = Globex Ltd'))
  expect(screen.getByTestId('recent-strip-view')).not.toHaveTextContent('cust-1')
})

test('a plain filter names its column by its label', async ({ admin }) => {
  await seed(admin)
  const filters = JSON.stringify([['item', '=', 'Widgets']])
  await renderApp(`/featherbase/admin/${enc(ORDER)}?filters=${enc(filters)}`, admin)
  await waitFor(() => expect(screen.getByTestId('filter-chip')).toHaveTextContent('Item = Widgets'))
})

test('a link cell in the map\'s row list reads as a title and moves the map', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/map/${enc(ORDER)}/ord-1`, admin)
  const self = await screen.findByTestId('map-self-row')
  const hop = await within(self).findByRole('button', { name: 'Globex Ltd' })
  expect(within(self).getByTestId('map-row')).not.toHaveTextContent('cust-1')
  fireEvent.click(hop)
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Globex Ltd'))
})
