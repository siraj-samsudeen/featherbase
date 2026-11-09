// A Table's storage (#860) on its settings page, when the browser refuses to
// copy it: the person is told to select it instead.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { rowHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

test('storage the browser refuses to copy is to be selected by hand', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Tsc Plant', columns: [{ column_name: 'plant_name', column_type: 'Data' }] })
  await renderApp(rowHref('Table', 'Tsc Plant'), admin)
  const storage = await screen.findByTestId('table-storage', {}, { timeout: 10_000 })
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'))
  await user.click(within(storage).getByRole('button', { name: 'Copy storage' }))
  expect(await within(storage).findByRole('status')).toHaveTextContent('Copy unavailable. Select the storage text to copy it.')
})
