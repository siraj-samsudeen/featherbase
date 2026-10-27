// Peeking and the related tabs when what they point at went away after the
// form opened: a connected Table deleted, a connected row deleted. Gaps the
// merged web coverage report (ADR 0012) showed. Each "cannot load" comes from
// the server's real answer, not a stub.
import { fireEvent, screen, within } from '@testing-library/react'
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
  await renderApp(`/featherbase/admin/${enc('Prf Customer')}/${id}`, admin)
  await screen.findByTestId('connections-panel', {}, { timeout: 10_000 })
  await screen.findByTestId('connection-count-Prf Order')
}

test('peeking at a row deleted after its list was shown says it cannot be loaded', async ({ admin }) => {
  const { asha, order } = await seed(admin)
  await openCustomer(admin, asha.row_id)
  fireEvent.click(screen.getByTestId('connection-peek-Prf Order'))
  const list = await screen.findByTestId('peek-panel-0')
  const [row] = await within(list).findAllByTestId('peek-list-row')
  await admin.delete(`/api/table/${enc('Prf Order')}/${order.row_id}`)
  fireEvent.click(row)
  const record = await screen.findByTestId('peek-panel-1')
  expect(await within(record).findByText(`Cannot load Prf Order ${order.row_id}`)).toBeInTheDocument()
})

test('peeking at, or opening the tab of, a connected Table deleted meanwhile says it cannot be loaded', async ({ admin }) => {
  const user = userEvent.setup()
  const { asha } = await seed(admin)
  await openCustomer(admin, asha.row_id)
  await admin.delete(`/api/table_def/${enc('Prf Order')}`)

  fireEvent.click(screen.getByTestId('connection-peek-Prf Order'))
  const list = await screen.findByTestId('peek-panel-0')
  expect(await within(list).findByText('Cannot load Prf Order')).toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })

  await user.click(screen.getByTestId('related-tab-Prf Order'))
  expect(await screen.findByText('Cannot load Prf Order')).toBeInTheDocument()
  expect(screen.queryByTestId('embedded-list')).not.toBeInTheDocument()
})
