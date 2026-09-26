import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

test('generated labels resolve real controls, stay stable on edits, and distinguish repeated child cells', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Label Line', kind: 'sub_table',
    columns: [{ column_name: 'description', column_type: 'Data', label: 'Description' }],
  })
  await admin.post('/api/table_def', {
    name: 'Label Form',
    columns: [
      { column_name: 'description', column_type: 'Data', label: 'Description' },
      { column_name: 'title', column_type: 'Data', label: 'Title', reqd: true },
      { column_name: 'active', column_type: 'Check', label: 'Active' },
      { column_name: 'stage', column_type: 'Choice', label: 'Stage', choices: 'Draft\nReady' },
      { column_name: 'owner_ref', column_type: 'Reference', label: 'Owner reference', reference_table: 'User' },
      { column_name: 'evidence', column_type: 'Attach', label: 'Evidence' },
      { column_name: 'lines', column_type: 'Sub-table', label: 'Lines', row_table: 'Label Line' },
      { column_name: 'extras', column_type: 'Sub-table', label: 'Extras', row_table: 'Label Line' },
    ],
  })
  await renderApp('/featherbase/admin/Label%20Form/new', admin)
  const plain = await screen.findByLabelText('Description')
  const required = screen.getByLabelText('Title')
  const check = screen.getByLabelText('Active')
  const choice = screen.getByLabelText('Stage')
  expect(plain).toHaveAttribute('data-field', 'description')
  expect(required).toHaveAttribute('data-field', 'title')
  expect(required).toHaveAccessibleName('Title')
  expect(required).toHaveAttribute('aria-required', 'true')
  expect(check).toHaveAttribute('type', 'checkbox')
  expect(choice.tagName).toBe('SELECT')
  expect(screen.getByLabelText('Owner reference')).toHaveAttribute('role', 'combobox')
  expect(screen.getByLabelText('Evidence')).toHaveAttribute('type', 'file')
  expect(screen.getByRole('button', { name: 'Attach file — Evidence' })).toBeVisible()
  const id = plain.id
  const user = userEvent.setup()
  await user.type(plain, 'Main description')
  expect(screen.getByLabelText('Description').id).toBe(id)
  await user.click(await screen.findByTestId('add-row-lines'))
  await user.click(screen.getByTestId('add-row-lines'))
  await user.click(await screen.findByTestId('add-row-extras'))
  await user.type(screen.getByLabelText('Lines, Description, row 1'), 'Apple')
  await user.type(screen.getByLabelText('Lines, Description, row 2'), 'Pear')
  await user.type(screen.getByLabelText('Extras, Description, row 1'), 'Plum')
  const controls = [...document.querySelectorAll<HTMLInputElement>('input[id], select[id], textarea[id]')]
  expect(new Set(controls.map((c) => c.id)).size).toBe(controls.length)
  const apple = screen.getByLabelText('Lines, Description, row 1')
  const pear = screen.getByLabelText('Lines, Description, row 2')
  const plum = screen.getByLabelText('Extras, Description, row 1')
  const [appleId, pearId, plumId] = [apple.id, pear.id, plum.id]
  const grid = within(screen.getByRole('group', { name: 'Lines' }))
  await user.click(grid.getAllByRole('button', { name: 'Move row up' })[1])
  expect(screen.getByLabelText('Lines, Description, row 1')).toHaveValue('Pear')
  expect(screen.getByLabelText('Lines, Description, row 1')).toBe(pear)
  expect(pear.id).toBe(pearId)
  expect(document.getElementById(appleId)).toBe(apple)
  await user.click(grid.getAllByRole('button', { name: 'Remove row' })[0])
  await waitFor(() => expect(screen.queryByLabelText('Lines, Description, row 2')).not.toBeInTheDocument())
  expect(screen.getByLabelText('Lines, Description, row 1')).toHaveValue('Apple')
  expect(screen.getByLabelText('Extras, Description, row 1')).toHaveValue('Plum')
  expect(screen.getByLabelText('Lines, Description, row 1')).toBe(apple)
  expect(apple.id).toBe(appleId)
  expect(document.getElementById(pearId)).toBeNull()
  expect(document.getElementById(plumId)).toBe(plum)
  await user.type(apple, ' edited')
  expect(document.getElementById(appleId)).toBe(apple)
  await user.click(screen.getByTestId('add-row-lines'))
  expect(screen.getByLabelText('Lines, Description, row 2').id).not.toBe(pearId)
})
