// A list's links (#910): a Ctrl-click is the browser's, and a nested row's
// link to a row the viewer cannot read is neutral words, never its id. And a
// list whose Table's details fail to come back after a change says so.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { tableHref } from 'shared'
import { createUserWithRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'
import { SITE, seedSites } from './relational-fixture'

const T = { timeout: 10_000 }

test("Ctrl-click on a list's link is left to the browser, a new tab", async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  const line = (await screen.findByRole('link', { name: 'Enchakkal' }, T)).closest('tr')!
  const region = await within(line).findByRole('link', { name: 'Kerala · KL' }, T)
  // fireEvent answers true when no handler took the click (preventDefault).
  expect(fireEvent.click(region, { ctrlKey: true })).toBe(true)
  expect(screen.queryByRole('complementary', { name: /Kerala/ })).not.toBeInTheDocument()
})

test("a nested row's link to a row the viewer cannot read shows no name and no id", async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Lln Customer', id_pattern: 'prompt', title_column: 'customer_name',
    columns: [{ column_name: 'customer_name', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Lln Customer', row: { row_id: 'C-7', customer_name: 'Acme Traders' } })
  await admin.post('/api/table_def', { name: 'Lln Line', kind: 'sub_table',
    columns: [{ column_name: 'customer', column_type: 'Reference', reference_table: 'Lln Customer', label: 'Customer' }] })
  await admin.post('/api/table_def', { name: 'Lln Order', id_pattern: 'prompt', columns: [
    { column_name: 'label', column_type: 'Data', label: 'Label', in_list_view: true },
    { column_name: 'lines', column_type: 'Sub-table', row_table: 'Lln Line', label: 'Lines' },
  ] })
  await admin.post('/api/save_row', { table: 'Lln Order', row: { row_id: 'O-1', label: 'First order', lines: [{ customer: 'C-7' }] } })
  const viewer = await createUserWithRole(admin, createUser, { role: 'Lln Order Reader', table: ['Lln Order', 'Lln Line'], can_read: true })
  await renderApp(tableHref('Lln Order'), viewer)
  await userEvent.click((await screen.findAllByTestId('row-expand', {}, T))[0])
  const lines = await screen.findByTestId('inline-children-lines', {}, T)
  expect(await within(lines).findByText('A row you cannot see', {}, T)).toBeInTheDocument()
  expect(lines).not.toHaveTextContent('C-7')
  expect(lines).not.toHaveTextContent('Acme Traders')
})

test("a list whose Table's details cannot be read again after a change says it cannot be loaded", async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  await screen.findByRole('link', { name: 'Enchakkal' }, T)
  await userEvent.click(screen.getByTestId('list-columns'))
  // The network drops just as the list asks for its Table's details again.
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (path.includes(':meta')) throw new TypeError('Failed to fetch')
    return real(input, init)
  })
  await userEvent.click(await screen.findByTestId('list-make-default', {}, T))
  await waitFor(() => expect(screen.getByTestId('list-error')).toHaveTextContent('Cannot load Nv Site'), T)
})
