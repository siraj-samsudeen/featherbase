// NAM-001: the Naming page of an existing Table — naming rows after one of its
// columns, a save the server refuses, and a Table that is not there. Gaps the
// merged web coverage report (ADR 0012) showed: no test picked a column as
// the naming rule. Assertions read the stored rule back and create a row by it.
import { tableSlug } from 'shared'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
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
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(T))}/naming`, admin)
  await user.selectOptions(await screen.findByTestId('naming-naming', {}, { timeout: 8000 }), 'field:code')
  expect(screen.getByTestId('naming-naming-preview')).toHaveTextContent('Each row takes its id from Store code')
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
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(T))}/naming`, admin)
  await user.selectOptions(await screen.findByTestId('naming-naming', {}, { timeout: 8000 }), 'prompt')
  await admin.delete(`/api/table_def/${encodeURIComponent(T)}`)
  await user.click(screen.getByTestId('naming-save'))
  expect(await screen.findByTestId('naming-save-error')).toHaveTextContent(/^Table Tnm Store was deleted by Administrator on /)
})

test('the Naming page of a Table that is not there says so', async ({ admin }) => {
  await renderApp('/featherbase/admin/table/tnm-nowhere/naming', admin)
  expect(await screen.findByText('Page not found', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(screen.queryByTestId('table-naming')).not.toBeInTheDocument()
  expect(screen.queryByTestId('naming-save')).not.toBeInTheDocument()
})

// Moved from the deleted e2e/naming-series.spec.ts (NAM-001): an existing
// Table, say one an import left on random ids, can be switched to a series.
test('the Naming page opens from the Table administration menu of the list', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(T))}`, admin)
  await user.click(await screen.findByRole('button', { name: 'Table administration' }, { timeout: 8000 }))
  await user.click(screen.getByTestId('open-naming'))
  expect(await screen.findByTestId('table-naming', {}, { timeout: 8000 })).toBeInTheDocument()
})

test('switching a random-id Table to a series offers the prefix taken from its name, and stores the series', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Naming Demo', id_pattern: 'hash', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await renderApp('/featherbase/admin/table/naming-demo/naming', admin)
  const naming = await screen.findByTestId('naming-naming', {}, { timeout: 8000 })
  expect(naming).toHaveValue('hash')
  await user.selectOptions(naming, 'series')
  expect(screen.getByTestId('naming-naming-prefix')).toHaveValue('NAMING-DEMO-')
  await user.clear(screen.getByTestId('naming-naming-prefix'))
  await user.type(screen.getByTestId('naming-naming-prefix'), 'EXISTING-')
  await user.click(screen.getByTestId('naming-save'))
  expect(await screen.findByTestId('naming-saved')).toHaveTextContent('Saved')
  expect(((await admin.get(`/api/table/${encodeURIComponent('Naming Demo')}:meta`)) as { id_pattern: string }).id_pattern).toBe('EXISTING-.###')
})

test('choosing a random id stores that rule', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Tnm Bin', id_pattern: 'prompt', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await renderApp(`/featherbase/admin/table/tnm-bin/naming`, admin)
  await user.selectOptions(await screen.findByTestId('naming-naming', {}, { timeout: 8000 }), 'hash')
  await user.click(screen.getByTestId('naming-save'))
  expect(await screen.findByTestId('naming-saved')).toHaveTextContent('Saved')
  expect(((await admin.get(`/api/table/${encodeURIComponent('Tnm Bin')}:meta`)) as { id_pattern: string }).id_pattern).toBe('hash')
})

test('a rule the network drops says it failed to save', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(T))}/naming`, admin)
  await user.selectOptions(await screen.findByTestId('naming-naming', {}, { timeout: 8000 }), 'field:code')
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith('/id_pattern')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
  await user.click(screen.getByTestId('naming-save'))
  expect(await screen.findByTestId('naming-save-error')).toHaveTextContent('Failed to save')
})
