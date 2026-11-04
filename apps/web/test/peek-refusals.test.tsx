// Peeking and native related rows when what they point at went away after the
// form opened: a connected Table deleted, a connected row deleted. Gaps the
// merged web coverage report (ADR 0012) showed. Each "cannot load" comes from
// the server's real answer, not a stub.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Saved = { row_id: string }
const enc = encodeURIComponent

async function seed(admin: { post: <T>(p: string, b: unknown) => Promise<T> }) {
  await admin.post('/api/table_def', {
    name: 'Prf Customer',
    columns: [{ column_name: 'label', column_type: 'Data', label: 'Label', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Prf Order',
    columns: [
      { column_name: 'label', column_type: 'Data', label: 'Label', in_list_view: true },
      { column_name: 'customer', column_type: 'Reference', label: 'Customer', reference_table: 'Prf Customer' },
    ],
  })
  const asha = await admin.post<Saved>('/api/save_row', { table: 'Prf Customer', row: { label: 'Asha' } })
  const order = await admin.post<Saved>('/api/save_row', { table: 'Prf Order', row: { label: 'Only order', customer: asha.row_id } })
  return { asha, order }
}

async function openCustomer(admin: Parameters<typeof renderApp>[1], id: string) {
  const app = await renderApp(`/featherbase/admin/table/prf-customer/row/${id}`, admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Related' }))
  const relationships = await screen.findByRole('navigation', { name: 'Relationships' })
  expect(within(relationships).getByRole('button', { name: /^Prf Order · customer\s*1$/ })).toHaveAttribute('aria-pressed', 'true')
  return app
}

test('peeking at a row deleted after its list was shown says it cannot be loaded', async ({ admin }) => {
  const { asha, order } = await seed(admin)
  await openCustomer(admin, asha.row_id)
  fireEvent.click(within(screen.getByRole('region', { name: 'Related rows' })).getByRole('button', { name: 'Peek' }))
  const list = await screen.findByTestId('peek-panel-0')
  const [row] = await within(list).findAllByTestId('peek-list-row')
  await admin.delete(`/api/table/${enc('Prf Order')}/${order.row_id}`)
  fireEvent.click(row)
  const record = await screen.findByTestId('peek-panel-1')
  expect(await within(record).findByText(`Cannot load Prf Order ${order.row_id}`)).toBeInTheDocument()
})

test('peeking at, or selecting, a connected Table deleted meanwhile says it cannot be loaded', async ({ admin }) => {
  const user = userEvent.setup()
  const { asha } = await seed(admin)
  // Switch away before deletion so selecting Orders again mounts a fresh
  // native list, rather than inspecting the already-mounted successful list.
  await admin.post('/api/table_def', {
    name: 'Prf Visit',
    columns: [{ column_name: 'customer', column_type: 'Reference', reference_table: 'Prf Customer' }],
  })
  await openCustomer(admin, asha.row_id)
  const relationships = screen.getByRole('navigation', { name: 'Relationships' })
  const originalRows = screen.getByRole('region', { name: 'Related rows' })
  await within(originalRows).findByText('Only order')
  await user.click(within(relationships).getByRole('button', { name: /^Prf Visit · customer\s*0$/ }))
  await waitFor(() => expect(originalRows).not.toBeInTheDocument())
  await admin.delete(`/api/table_def/${enc('Prf Order')}`)

  await user.click(within(relationships).getByRole('button', { name: /^Prf Order · customer\s*1$/ }))
  const related = screen.getByRole('region', { name: 'Related rows' })
  fireEvent.click(within(related).getByRole('button', { name: 'Peek' }))
  const list = await screen.findByTestId('peek-panel-0')
  expect(await within(list).findByText('Cannot load Prf Order')).toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })

  // The remounted native list must show its own refusal, not stale rows
  // concealed behind the independent Peek query's error.
  expect(await within(related).findByTestId('list-rows-error')).toHaveTextContent(/Prf Order/)
  expect(within(related).queryByText('Only order')).not.toBeInTheDocument()
})

test('opening Related after its owner was deleted shows a refusal, not an empty relationship list', async ({ admin }) => {
  const user = userEvent.setup()
  const { asha, order } = await seed(admin)
  await renderApp(`/featherbase/admin/table/prf-customer/row/${asha.row_id}`, admin)
  await screen.findByRole('textbox', { name: 'Label' })
  await admin.delete(`/api/table/${enc('Prf Order')}/${order.row_id}`)
  await admin.delete(`/api/table/${enc('Prf Customer')}/${asha.row_id}`)

  await user.click(screen.getByRole('tab', { name: 'Related' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot load relationships.')
  expect(screen.queryByRole('navigation', { name: 'Relationships' })).not.toBeInTheDocument()
  expect(screen.queryByText('No readable relationships.')).not.toBeInTheDocument()
})
