// A read-only money or number column in a row someone may edit shows its value once, formatted as System
// Settings say (#1419): never the raw stored text with the formatted value echoed under it. An editable one
// keeps its input and the echo. (A row someone may only read already shows each value once.)
import { screen, waitFor } from '@testing-library/react'
import { tableHref } from 'shared'
import { sql } from 'server/src/db'
import { invalidateMeta } from 'server/src/meta'
import { test, expect, renderApp } from './pg-test'

const T = { timeout: 10_000 }

test('a read-only Currency and Float column show their formatted value once; an editable one keeps its echo', async ({ admin }) => {
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Frn Plan', id_pattern: 'prompt', title_column: 'plan_name', columns: [
    { column_name: 'plan_name', column_type: 'Data', label: 'Plan name' },
    { column_name: 'amount', column_type: 'Currency', label: 'Amount' },
    { column_name: 'factor', column_type: 'Float', label: 'Factor' },
    { column_name: 'target', column_type: 'Currency', label: 'Target' },
  ] })
  await admin.post('/api/save_row', { table: 'Frn Plan', row: { row_id: 'P-1', plan_name: 'December', amount: 7690158, factor: 1.2151118516921997, target: 500 } })
  // read-only after the values are in (the server never writes a read-only column from a save), as a copied
  // table's columns are
  await sql`update column_def set read_only = true where parent = 'Frn Plan' and column_name in ('amount', 'factor')`
  invalidateMeta('Frn Plan')
  await renderApp(`${tableHref('Frn Plan')}/row/P-1`, admin)
  await waitFor(() => expect(screen.getByLabelText('Amount')).toHaveValue('₹76,90,158.00'), T)
  expect(screen.getByLabelText('Factor')).toHaveValue('1.22')
  expect(screen.queryByTestId('preview-amount')).toBeNull()
  expect(screen.queryByTestId('preview-factor')).toBeNull()
  expect(screen.getByTestId('preview-target')).toHaveTextContent('₹500.00')
})
