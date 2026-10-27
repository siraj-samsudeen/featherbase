// table-deletion: "Only the builder authority can delete a table, and
// confirmation names the cost". The dialog is React-side; the row count it
// names and the table it leaves alone are checked against the real server.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const DT = 'Td Unwanted Zones'
const ENC = encodeURIComponent(DT)

async function seed(admin: { post: (p: string, b: unknown) => Promise<unknown> }) {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'zone_name', column_type: 'Data' }] })
  await admin.post(`/api/table/${ENC}:import`, {
    rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((zone_name) => ({ zone_name })),
  })
}

describe('Only the builder authority can delete a table, and confirmation names the cost', () => {
  test('the confirmation names the table and its eight rows, and cancelling leaves everything as it was', async ({
    admin,
  }) => {
    const user = userEvent.setup()
    await seed(admin)
    await renderApp(`/featherbase/admin/${ENC}`, admin)
    await user.click(await screen.findByTestId('delete-table', undefined, { timeout: 10_000 }))

    const dialog = await screen.findByTestId('delete-table-dialog')
    expect(dialog).toHaveTextContent(`Delete ${DT}?`)
    await waitFor(() => expect(dialog).toHaveTextContent('8 rows will be permanently deleted'))
    expect(dialog).toHaveTextContent('This cannot be undone')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByTestId('delete-table-dialog')).not.toBeInTheDocument())
    const count = (await admin.get(`/api/table/${ENC}:count`)) as { count: number }
    expect(count.count).toBe(8)
  })
})
