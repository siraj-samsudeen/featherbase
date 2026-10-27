// #408: after migration 0107, Person has no employee_code / stylehr_username.
// A Person import whose file still carries those headers says where the data
// goes now, cannot map or tick that column, and never offers to create it.
import { screen, fireEvent, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

test('#408 a Person file with an employee_code column: the column is refused with a pointer, never created', async ({ admin }) => {
  clearSession()
  await renderApp('/featherbase/admin/import?table=Person', admin)
  const bytes = new TextEncoder().encode('full_name,email,employee_code\nSynthetic One,one@x.test,RR-0101\n').buffer
  const file = new File([bytes], 'people.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [file] } })
  const notice = await screen.findByTestId('iw-retired-0-2')
  expect(notice).toHaveTextContent('employee_code is no longer a Person field — add codes on the Identifiers panel of the Person form')
  const select = screen.getByTestId('iw-map-0-2') as HTMLSelectElement
  expect(select).toBeDisabled()
  expect(select.value).toBe('')
  expect(within(select).queryByRole('option', { name: /employee_code/i })).toBeNull()
  expect(screen.getByTestId('iw-map-use-0-2')).not.toBeChecked()
  expect(screen.getByTestId('iw-map-use-0-2')).toBeDisabled()
  // The other columns map as usual.
  expect((screen.getByTestId('iw-map-0-0') as HTMLSelectElement).value).toBe('full_name')
  clearSession()
})
