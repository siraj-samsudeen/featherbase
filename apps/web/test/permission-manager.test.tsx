// SET-003: the role × action permission matrix for a Table, reached from the
// list's Permissions button. Gaps the merged web coverage report (ADR 0012)
// showed: no e2e spec opens this page. Assertions read the stored Permission
// rows back through the API, not just the ticked boxes.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const DT = 'Pm Depots'
const ENC = encodeURIComponent(DT)
const ROLE = 'Pm Depot Clerk'

type Perms = { roles: string[]; perms: { role: string; can_read: boolean; can_write: boolean }[] }

async function seed(admin: { post: (p: string, b: unknown) => Promise<unknown> }) {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'depot', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
}

test('the list leads to the matrix; ticking and saving stores the grant', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/${ENC}`, admin)
  await user.click(await screen.findByTestId('open-permissions', undefined, { timeout: 10_000 }))
  expect(await screen.findByRole('heading', { name: `Permissions — ${DT}` })).toBeInTheDocument()

  const save = screen.getByTestId('perm-save')
  expect(save).toBeDisabled()
  expect(screen.getByTestId(`perm-${ROLE}-can_read`)).not.toBeChecked()
  await user.click(screen.getByTestId(`perm-${ROLE}-can_read`))
  await user.click(screen.getByTestId(`perm-${ROLE}-can_write`))
  expect(save).toBeEnabled()
  await user.click(save)
  expect(await screen.findByTestId('perm-saved')).toHaveTextContent('Saved')
  expect(save).toBeDisabled()

  const stored = (await admin.get(`/api/permissions/${ENC}`)) as Perms
  expect(stored.perms.find((p) => p.role === ROLE)).toMatchObject({ can_read: true, can_write: true })

  // Reopening shows the stored grant, and changing it updates the same row.
  await user.click(screen.getByTestId(`perm-${ROLE}-can_write`))
  await user.click(screen.getByTestId('perm-save'))
  await waitFor(async () => {
    const again = (await admin.get(`/api/permissions/${ENC}`)) as Perms
    expect(again.perms.filter((p) => p.role === ROLE)).toEqual([expect.objectContaining({ can_read: true, can_write: false })])
  })
})

test('someone who is not a System Manager is told why instead of shown the matrix', async ({ admin, createUser }) => {
  await seed(admin)
  // A grant of their own opens the Admin to them (#410); this one is on Person.
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: ROLE, can_read: true } })
  const clerk = await createUser({ roles: [ROLE] })
  await renderApp(`/featherbase/admin/permissions/${ENC}`, clerk)
  const error = await screen.findByTestId('perm-error')
  expect(error.textContent).toMatch(/System Manager/)
  expect(screen.queryByTestId('permission-manager')).not.toBeInTheDocument()
})
