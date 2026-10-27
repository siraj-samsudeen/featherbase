// Merging one Table into another when the server refuses: a target deleted
// after it was chosen, and a merge page for a Table that is not there. Gaps
// the merged web coverage report (ADR 0012) showed; the refusals are real.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const SRC = 'Tmr Source'
const DST = 'Tmr Target'

test('a target deleted after it was chosen is refused with the reason, and the source keeps its rows', async ({ admin }) => {
  const user = userEvent.setup()
  for (const name of [SRC, DST])
    await admin.post('/api/table_def', { name, columns: [{ column_name: 'zone_name', label: 'Zone', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: SRC, row: { zone_name: 'Fresh' } })
  await renderApp(`/featherbase/admin/${encodeURIComponent(SRC)}/merge`, admin)
  const picker = await screen.findByTestId('tm-target', {}, { timeout: 8000 })
  await waitFor(() => expect(within(picker).getByRole('option', { name: DST })).toBeInTheDocument(), { timeout: 10_000 })
  await user.selectOptions(picker, DST)
  await screen.findByTestId('tm-mapping', undefined, { timeout: 10_000 })
  await admin.delete(`/api/table_def/${encodeURIComponent(DST)}`)
  await user.click(screen.getByTestId('tm-go'))
  expect(await screen.findByTestId('tm-error')).toHaveTextContent(/^Table Tmr Target was deleted by Administrator on /)
  expect(((await admin.get(`/api/table/${encodeURIComponent(SRC)}`)) as { total: number }).total).toBe(1)
})

test('the merge page of a Table that is not there says so', async ({ admin }) => {
  await renderApp('/featherbase/admin/Tmr%20Nowhere/merge', admin)
  expect(await screen.findByTestId('tm-error', {}, { timeout: 8000 })).toHaveTextContent(/not found/i)
})
