// Merging one Table into another when the server refuses: a target deleted
// after it was chosen, a merge page for a Table that is not there, and a merge
// the network drops. Gaps
// the merged web coverage report (ADR 0012) showed; the refusals are real.
import { tableSlug } from 'shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const SRC = 'Tmr Source'
const DST = 'Tmr Target'

test('a target deleted after it was chosen is refused with the reason, and the source keeps its rows', async ({ admin }) => {
  const user = userEvent.setup()
  for (const name of [SRC, DST])
    await admin.post('/api/table_def', { name, columns: [{ column_name: 'zone_name', label: 'Zone', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: SRC, row: { zone_name: 'Fresh' } })
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(SRC))}/merge`, admin)
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
  await renderApp('/featherbase/admin/table/tmr-nowhere/merge', admin)
  expect(await screen.findByText('Page not found', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(screen.queryByTestId('tm-target')).not.toBeInTheDocument()
  expect(screen.queryByTestId('tm-go')).not.toBeInTheDocument()
})

test('a merge the network drops says the merge failed, and the source keeps its rows', async ({ admin }) => {
  const user = userEvent.setup()
  for (const name of [SRC, DST])
    await admin.post('/api/table_def', { name, columns: [{ column_name: 'zone_name', label: 'Zone', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: SRC, row: { zone_name: 'Fresh' } })
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(SRC))}/merge`, admin)
  const picker = await screen.findByTestId('tm-target', {}, { timeout: 8000 })
  await waitFor(() => expect(within(picker).getByRole('option', { name: DST })).toBeInTheDocument(), { timeout: 10_000 })
  await user.selectOptions(picker, DST)
  await screen.findByTestId('tm-mapping', undefined, { timeout: 10_000 })
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    init?.method === 'POST' && String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).includes(':import')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
  await user.click(screen.getByTestId('tm-go'))
  expect(await screen.findByTestId('tm-error')).toHaveTextContent('Merge failed')
  expect(((await admin.get(`/api/table/${encodeURIComponent(SRC)}`)) as { total: number }).total).toBe(1)
})
