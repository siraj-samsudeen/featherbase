import { fireEvent, screen, waitFor } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

const table = 'Override Editor Shelf'
const path = '/featherbase/admin/Metadata%20Override'

test('a column adjustment receives its ID from the generic form', async ({ admin }) => {
  await admin.post('/api/table_def', { name: table, columns: [
    { column_name: 'floor', column_type: 'Data', label: 'Floor' },
  ] })
  await renderApp(`${path}/new?prefill=${encodeURIComponent(JSON.stringify({ table_name: table }))}`, admin)
  await screen.findByTestId('form-view')
  expect(document.querySelector('[data-field=row_id]')).toBeNull()
  const column = await screen.findByLabelText('Column')
  await waitFor(() => expect(column).toHaveTextContent('floor'))
  fireEvent.change(column, { target: { value: 'floor' } })
  fireEvent.change(screen.getByLabelText('Setting'), { target: { value: 'Hidden (hidden)' } })
  fireEvent.click(screen.getByLabelText('Value'))
  fireEvent.click(screen.getByTestId('form-save'))
  await waitFor(async () => {
    const result = await admin.get<{ data: { row_id: string; value: string }[] }>(`/api/table/Metadata%20Override?filters=${encodeURIComponent(JSON.stringify([['table_name', '=', table]]))}&fields=${encodeURIComponent(JSON.stringify(['row_id', 'value']))}`)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].value).toBe('true')
    expect(result.data[0].row_id).toBeTruthy()
  })
})

for (const value of ['false', '0', 'true', '1']) {
  test(`editing stored boolean text ${value} uses a checkbox`, async ({ admin }) => {
    await admin.post('/api/table_def', { name: table, columns: [{ column_name: 'floor', column_type: 'Data' }] })
    await admin.post('/api/table/Metadata%20Override', {
      row_id: 'editor-existing', table_name: table, column_name: 'floor', property: 'hidden', value,
    })
    await renderApp(`${path}/editor-existing`, admin)
    const control = await screen.findByRole('checkbox', { name: 'Value' })
    await waitFor(() => expect(control).toBeEnabled())
    expect(control).toHaveProperty('checked', value === 'true' || value === '1')
    fireEvent.click(control)
    fireEvent.click(screen.getByTestId('form-save'))
    await waitFor(async () => {
      const row = await admin.get<{ value: string }>('/api/table/Metadata%20Override/editor-existing')
      expect(row.value).toBe(value === 'true' || value === '1' ? 'false' : 'true')
    })
  })
}
