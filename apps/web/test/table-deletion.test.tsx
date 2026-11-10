// table-deletion: "Only the builder authority can delete a table, and
// confirmation names the cost". The dialog is React-side; the row count it
// names and the table it leaves alone are checked against the real server.

import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { expectApiError } from 'server/test/fixtures'
import { holdResponses } from './held-requests'

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
    await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(decodeURIComponent(ENC)))}`, admin)
    await user.click(await screen.findByRole('button', { name: 'Table administration' }))
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

  // The rest moved from e2e/table-deletion.spec.ts (DEL-J1, DEL-J2; #1080).
  // The server's rules behind them are apps/server/test/table-deletion.test.ts.
  test('DEL-J1: Table administration offers Delete Table beside Naming and Permissions', async ({ admin }) => {
    await seed(admin)
    await openAdministration(admin, DT)
    expect(await screen.findByTestId('open-naming')).toBeInTheDocument()
    expect(screen.getByTestId('open-permissions')).toBeInTheDocument()
    expect(await screen.findByTestId('delete-table', undefined, { timeout: 10_000 })).toBeInTheDocument()
  })

  test("DEL-R3: a system Table's administration offers no Delete Table", async ({ admin }) => {
    await openAdministration(admin, 'Person')
    expect(await screen.findByTestId('open-naming')).toBeInTheDocument()
    // The same metadata decides the affordance on a user Table, which shows it.
    await waitFor(() => expect(screen.getByTestId('open-permissions')).toBeInTheDocument())
    expect(screen.queryByTestId('delete-table')).not.toBeInTheDocument()
  })

  test('DEL-J1: confirming deletes the Table and lands on All tables, which no longer lists it', async ({ admin }) => {
    await seed(admin)
    await admin.post('/api/table_def', { name: 'Td Kept Zones', columns: [{ column_name: 'zone_name', column_type: 'Data' }] })
    const { router } = await openAdministration(admin, DT)
    await userEvent.click(await screen.findByTestId('delete-table', undefined, { timeout: 10_000 }))
    await confirm(await screen.findByTestId('delete-table-dialog'))

    expect(await screen.findByTestId('all-tables-page')).toBeInTheDocument()
    expect(pathOf(router)).toBe('/featherbase/admin/all-tables')
    const nav = await screen.findByTestId('table-nav')
    await waitFor(() => expect(nav).toHaveTextContent('Td Kept Zones'))
    expect(nav).not.toHaveTextContent(DT)
    await expectApiError(admin.get(`/api/table/${ENC}:meta`), { status: 404 })
  })

  test('DEL-J2: a refused deletion names the referencing column, and the retry succeeds once it goes', async ({ admin }) => {
    const REF = 'Td Zone Bookings'
    await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'zone_name', column_type: 'Data' }] })
    await admin.post('/api/table_def', {
      name: REF,
      columns: [{ column_name: 'zone', column_type: 'Reference', reference_table: DT }],
    })
    const { router } = await openAdministration(admin, DT)
    await userEvent.click(await screen.findByTestId('delete-table', undefined, { timeout: 10_000 }))
    const dialog = await screen.findByTestId('delete-table-dialog')
    await confirm(dialog)
    expect(await within(dialog).findByTestId('delete-table-error')).toHaveTextContent(`${REF}.zone`)
    expect(await admin.get(`/api/table/${ENC}:meta`)).toMatchObject({ name: DT })

    await admin.delete(`/api/table_def/${encodeURIComponent(REF)}`)
    await confirm(dialog)
    expect(await screen.findByTestId('all-tables-page')).toBeInTheDocument()
    expect(pathOf(router)).toBe('/featherbase/admin/all-tables')
    await expectApiError(admin.get(`/api/table/${ENC}:meta`), { status: 404 })
  })
})

const pathOf = (router: unknown) => (router as { state: { location: { pathname: string } } }).state.location.pathname

async function openAdministration(admin: Parameters<typeof renderApp>[1], table: string) {
  const rendered = await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(table))}`, admin)
  await userEvent.click(await screen.findByRole('button', { name: 'Table administration' }))
  return rendered
}

/** The confirm button waits for the live row count before it arms. */
async function confirm(dialog: HTMLElement) {
  const button = within(dialog).getByTestId('delete-table-confirm')
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
}

describe('the delete dialog at its edges', () => {
  test('a Table of one row says 1 row will be deleted', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Td Lone Zone', columns: [{ column_name: 'zone_name', column_type: 'Data' }] })
    await admin.post('/api/save_row', { table: 'Td Lone Zone', row: { zone_name: 'A' } })
    await openAdministration(admin, 'Td Lone Zone')
    await userEvent.click(await screen.findByTestId('delete-table', undefined, { timeout: 10_000 }))
    const dialog = await screen.findByTestId('delete-table-dialog')
    await waitFor(() => expect(dialog).toHaveTextContent('1 row will be permanently deleted.'))
  })

  test("a view's dialog says its base's rows stay, and its button deletes the view", async ({ admin }) => {
    await seed(admin)
    await admin.post('/api/table_def', { name: 'Td Some Zones', kind: 'view', view_of: DT, view_filters: [['zone_name', '=', 'A']] })
    await openAdministration(admin, 'Td Some Zones')
    await userEvent.click(await screen.findByTestId('delete-table', undefined, { timeout: 10_000 }))
    const dialog = await screen.findByTestId('delete-table-dialog')
    expect(dialog).toHaveTextContent(`The view goes; the rows of ${DT} stay as they are.`)
    expect(within(dialog).getByTestId('delete-table-confirm')).toHaveTextContent('Delete view')
  })

  test('the button says Deleting… while the deletion is out', async ({ admin }) => {
    await seed(admin)
    await openAdministration(admin, DT)
    await userEvent.click(await screen.findByTestId('delete-table', undefined, { timeout: 10_000 }))
    const dialog = await screen.findByTestId('delete-table-dialog')
    const held = holdResponses(`/api/table_def/${ENC}`)
    await confirm(dialog)
    await held.asked
    expect(within(dialog).getByTestId('delete-table-confirm')).toHaveTextContent('Deleting…')
    expect(within(dialog).getByTestId('delete-table-cancel')).toBeDisabled()
    held.release()
    await waitFor(() => expect(screen.queryByTestId('delete-table-dialog')).not.toBeInTheDocument())
  })
})
