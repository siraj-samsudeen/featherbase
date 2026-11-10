// Small Admin page paths the merged web coverage report (ADR 0012) showed red:
// backing out of a column rename, the column editor and Explore for a Table
// that is not there (or was deleted), Find a person by another identifier and
// a value the server refuses or a search the network drops. Each refusal is the
// server's real answer.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { applySeedPack } from 'server/src/seed-packs'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const enc = encodeURIComponent

test('a column rename can be cancelled, leaving the name as it was', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Apg Zone', columns: [{ column_name: 'glor', label: 'Glor', column_type: 'Data' }] })
  await renderApp(`/featherbase/admin/table/apg-zone/columns`, admin)
  await user.click(await screen.findByTestId('ce-rename-glor', {}, { timeout: 8000 }))
  expect(screen.getByTestId('ce-rename-input-glor')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByTestId('ce-rename-input-glor')).not.toBeInTheDocument()
  const meta = (await admin.get(`/api/table/${enc('Apg Zone')}:meta`)) as { columns: { column_name: string }[] }
  expect(meta.columns.map((c) => c.column_name)).toContain('glor')
})

test('the column editor of a Table that is not there says so', async ({ admin }) => {
  await renderApp(`/featherbase/admin/table/apg-nowhere/columns`, admin)
  expect(await screen.findByText('Page not found', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(screen.queryByTestId('column-editor')).not.toBeInTheDocument()
  expect(screen.queryByTestId('ce-add-go')).not.toBeInTheDocument()
})

test('Explore of a Table deleted meanwhile says it cannot be loaded', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Apg Gone', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] })
  await admin.delete(`/api/table_def/${enc('Apg Gone')}`)
  await renderApp(`/featherbase/admin/explore?root=${enc('Apg Gone')}`, admin)
  expect(await screen.findByText('Cannot load Apg Gone', {}, { timeout: 8000 })).toBeInTheDocument()
})

test('Find a person by mobile phone: a value that is not a phone number is refused with the reason', async ({ admin }) => {
  await applySeedPack('jeyarama')
  await renderApp('/featherbase/admin/find-person', admin)
  const page = await screen.findByTestId('find-person', {}, { timeout: 8000 })
  const select = within(page).getByLabelText('Identifier')
  await waitFor(() => expect(within(select).getByRole('option', { name: 'Mobile phone' })).toBeInTheDocument())
  await userEvent.selectOptions(select, 'phone')
  expect(select).toHaveValue('phone')
  await userEvent.type(within(page).getByLabelText('Value'), 'not a number')
  await userEvent.click(within(page).getByRole('button', { name: 'Find' }))
  expect(await within(page).findByTestId('find-person-error')).toHaveTextContent('An Indian mobile number has 10 digits starting 6–9')
  expect(within(page).queryByTestId('find-person-results')).not.toBeInTheDocument()
})

test('Find a person: a search the network drops says the search did not work', async ({ admin }) => {
  await applySeedPack('jeyarama')
  await renderApp('/featherbase/admin/find-person', admin)
  const page = await screen.findByTestId('find-person', {}, { timeout: 8000 })
  const select = within(page).getByLabelText('Identifier')
  await waitFor(() => expect(within(select).getByRole('option', { name: 'Mobile phone' })).toBeInTheDocument())
  await userEvent.selectOptions(select, 'phone')
  await userEvent.type(within(page).getByLabelText('Value'), '9847012345')
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).startsWith('/api/identifiers?')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
  await userEvent.click(within(page).getByRole('button', { name: 'Find' }))
  expect(await within(page).findByTestId('find-person-error')).toHaveTextContent('That search did not work')
})
