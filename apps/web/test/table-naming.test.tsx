// NAM-001: the Naming page of an existing Table — naming rows after one of its
// columns, a save the server refuses, and a Table that is not there. Gaps the
// merged web coverage report (ADR 0012) showed: no test picked a column as
// the naming rule. Assertions read the stored rule back and create a row by it.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const T = 'Tnm Store'

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: T,
    columns: [{ column_name: 'code', column_type: 'Data', label: 'Store code' }],
  })
}

test('naming rows after a column stores that rule, and a new row takes its id from the column', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/naming/${encodeURIComponent(T)}`, admin)
  await user.selectOptions(await screen.findByTestId('naming-naming', {}, { timeout: 8000 }), 'field:code')
  expect(screen.getByTestId('naming-naming-preview')).toHaveTextContent('Each row takes its id from code')
  await user.click(screen.getByTestId('naming-save'))
  expect(await screen.findByTestId('naming-saved')).toHaveTextContent('Saved')
  // The select still shows the column picked, read back from the stored rule.
  expect(screen.getByTestId('naming-naming')).toHaveValue('field:code')

  const meta = (await admin.get(`/api/table/${encodeURIComponent(T)}:meta`)) as { id_pattern: string }
  expect(meta.id_pattern).toBe('field:code')
  const row = (await admin.post('/api/save_row', { table: T, row: { code: 'ATK' } })) as { row_id: string }
  expect(row.row_id).toBe('ATK')
})

test('a rule saved for a Table deleted meanwhile is refused, with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/naming/${encodeURIComponent(T)}`, admin)
  await user.selectOptions(await screen.findByTestId('naming-naming', {}, { timeout: 8000 }), 'prompt')
  await admin.delete(`/api/table_def/${encodeURIComponent(T)}`)
  await user.click(screen.getByTestId('naming-save'))
  expect(await screen.findByTestId('naming-save-error')).toHaveTextContent(/^Table Tnm Store was deleted by Administrator on /)
})

test('the Naming page of a Table that is not there says so', async ({ admin }) => {
  await renderApp('/featherbase/admin/naming/Tnm%20Nowhere', admin)
  await waitFor(() => expect(screen.getByTestId('naming-error')).toHaveTextContent(/not found/i), { timeout: 8000 })
})

test('choosing a random id stores that rule', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Tnm Bin', id_pattern: 'prompt', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await renderApp(`/featherbase/admin/naming/${encodeURIComponent('Tnm Bin')}`, admin)
  await user.selectOptions(await screen.findByTestId('naming-naming', {}, { timeout: 8000 }), 'hash')
  await user.click(screen.getByTestId('naming-save'))
  expect(await screen.findByTestId('naming-saved')).toHaveTextContent('Saved')
  expect(((await admin.get(`/api/table/${encodeURIComponent('Tnm Bin')}:meta`)) as { id_pattern: string }).id_pattern).toBe('hash')
})
