import { fireEvent, screen, waitFor } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'
import { rowHref, tableHref } from 'shared'

const table = 'Override Editor Shelf'
const path = tableHref('Metadata Override')

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

test('an adjustment saved before a column is chosen asks for a column or Whole Table', async ({ admin }) => {
  await admin.post('/api/table_def', { name: table, columns: [{ column_name: 'floor', column_type: 'Data', label: 'Floor' }] })
  await renderApp(`${path}/new?prefill=${encodeURIComponent(JSON.stringify({ table_name: table }))}`, admin)
  const column = await screen.findByLabelText('Column')
  await waitFor(() => expect(column).toHaveTextContent('floor'))
  fireEvent.click(screen.getByTestId('form-save'))
  expect(await screen.findByText('Choose a column or Whole Table')).toBeInTheDocument()
  const saved = await admin.get<{ data: unknown[] }>(`/api/table/Metadata%20Override?filters=${encodeURIComponent(JSON.stringify([['table_name', '=', table]]))}`)
  expect(saved.data).toEqual([])
})

test("a column's choices are edited one per line", async ({ admin }) => {
  await admin.post('/api/table_def', { name: table, columns: [{ column_name: 'floor', column_type: 'Choice', choices: 'G\n1' }] })
  await admin.post('/api/table/Metadata%20Override', {
    row_id: 'editor-choices', table_name: table, column_name: 'floor', property: 'choices', value: 'G\n1\n2',
  })
  await renderApp(rowHref('Metadata Override', 'editor-choices'), admin)
  const control = await screen.findByLabelText('Value')
  expect(control.tagName).toBe('TEXTAREA')
  expect(control).toHaveValue('G\n1\n2')
  expect(screen.getByText('One choice per line.')).toBeInTheDocument()
})

for (const value of ['false', '0', 'true', '1']) {
  test(`editing stored boolean text ${value} uses a checkbox`, async ({ admin }) => {
    await admin.post('/api/table_def', { name: table, columns: [{ column_name: 'floor', column_type: 'Data' }] })
    await admin.post('/api/table/Metadata%20Override', {
      row_id: 'editor-existing', table_name: table, column_name: 'floor', property: 'hidden', value,
    })
    await renderApp(rowHref('Metadata Override', 'editor-existing'), admin)
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

test('moving an adjustment refreshes already visited target forms', async ({ admin }) => {
  for (const name of ['Editor Warm Source', 'Editor Warm Destination'])
    await admin.post('/api/table_def', { name, columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  const row = await admin.post<{ row_id: string }>('/api/table/Metadata%20Override', {
    table_name: 'Editor Warm Source', column_name: 'title', property: 'label', value: 'Headline',
  })
  const source = `${tableHref('Editor Warm Source')}/new`
  const destination = `${tableHref('Editor Warm Destination')}/new`
  const { router } = await renderApp(source, admin)
  await screen.findByLabelText('Headline')
  await router.navigate({ to: destination })
  await screen.findByLabelText('Title')
  await router.navigate({ to: rowHref('Metadata Override', row.row_id) })
  await screen.findByDisplayValue('Headline')
  fireEvent.change(screen.getByLabelText('Table'), { target: { value: 'Editor Warm Destination' } })
  fireEvent.mouseDown(await screen.findByRole('button', { name: 'Editor Warm Destination' }))
  await waitFor(() => expect(screen.getByLabelText('Column')).toHaveTextContent('title'))
  fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'title' } })
  fireEvent.change(screen.getByLabelText('Setting'), { target: { value: 'Label (label)' } })
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'Headline' } })
  fireEvent.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-status')).toHaveTextContent('Saved'))
  await router.navigate({ to: source })
  await screen.findByLabelText('Title')
  expect(screen.queryByLabelText('Headline')).toBeNull()
  await router.navigate({ to: destination })
  await screen.findByLabelText('Headline')
  expect(screen.queryByLabelText('Title')).toBeNull()
})
