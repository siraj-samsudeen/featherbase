// SET-003: the permission matrix opens showing the grants already stored, and
// a save the server refuses says why. Gaps the merged web coverage report
// (ADR 0012) showed: permission-manager.test.tsx always opens an empty matrix.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const DT = 'Pms Depots'
const ENC = encodeURIComponent(DT)
const ROLE = 'Pms Depot Clerk'

async function seed(admin: { post: (p: string, b: unknown) => Promise<unknown> }) {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'depot', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: ROLE, can_read: true } })
}

test('a stored grant shows ticked when the matrix opens', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/permissions/${ENC}`, admin)
  expect(await screen.findByTestId(`perm-${ROLE}-can_read`, {}, { timeout: 8000 })).toBeChecked()
  expect(screen.getByTestId(`perm-${ROLE}-can_write`)).not.toBeChecked()
})

test('granting a role deleted meanwhile is refused, with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Pms Temp Role' } })
  await renderApp(`/featherbase/admin/permissions/${ENC}`, admin)
  await user.click(await screen.findByTestId('perm-Pms Temp Role-can_read', {}, { timeout: 8000 }))
  await admin.delete(`/api/table/Role/${encodeURIComponent('Pms Temp Role')}`)
  await user.click(screen.getByTestId('perm-save'))
  expect(await screen.findByTestId('perm-save-error')).toHaveTextContent('Invalid links for Permission')
  const stored = (await admin.get(`/api/permissions/${ENC}`)) as { perms: { role: string }[] }
  expect(stored.perms.map((p) => p.role)).not.toContain('Pms Temp Role')
})
