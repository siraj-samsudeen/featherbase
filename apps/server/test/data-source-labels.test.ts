// #914: platform Table labels read in sentence case, like the rest of the UI.
import { expect } from 'vitest'
import { test } from './pg-test'

test('Data Source columns are labelled in sentence case', async ({ admin }) => {
  const meta = await admin.get<{ columns: { column_name: string; label: string }[] }>('/api/table/Data%20Source:meta')
  const labels = Object.fromEntries(meta.columns.map(c => [c.column_name, c.label]))
  expect(labels).toMatchObject({
    url_env: 'Connection env var',
    root_path: 'Root path (csv-folder)',
    default_schema: 'Default schema',
    pool_max: 'Pool max',
    statement_timeout_ms: 'Statement timeout (ms)',
    table_allowlist: 'Table allowlist',
    conn_status: 'Connection status',
    last_checked_at: 'Last checked at',
    last_error: 'Last error',
  })
})
