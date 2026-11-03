// #830: a Person's Activity shows who gave or removed their roles, and when.
import { screen, waitFor, within } from '@testing-library/react'
import { sql } from 'server/src/db'
import { saveDoc } from 'server/src/document'
import { rowHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

test('#830: a Person\'s Activity shows a role granted and a role removed, by whom', async ({ admin }) => {
  for (const r of ['Rh Auditor', 'Rh Clerk']) {
    const [have] = await sql`select 1 from role where row_id = ${r}`
    if (!have) await saveDoc('Role', { row_id: r }, 'Administrator', 'insert')
  }
  const p = await admin.post<{ row_id: string; updated_at: string; roles: { row_id: string; role: string }[] }>('/api/save_row', {
    table: 'Person',
    row: { enabled: true, email: 'rh.activity@example.com', full_name: 'Rh Activity', roles: [{ role: 'Rh Clerk' }] },
  })
  const granted = await admin.post<typeof p>('/api/save_row', {
    table: 'Person',
    row: { row_id: p.row_id, updated_at: p.updated_at, roles: [...p.roles, { role: 'Rh Auditor' }] },
  })
  await admin.post('/api/save_row', {
    table: 'Person',
    row: { row_id: p.row_id, updated_at: granted.updated_at, roles: granted.roles.filter((r) => r.role === 'Rh Clerk') },
  })
  await renderApp(rowHref('Person', p.row_id), admin)
  const timeline = await screen.findByTestId('activity-timeline', {}, { timeout: 10_000 })
  // Activity names a field by its column, as for every other change (#421).
  await waitFor(() => {
    const diffs = within(timeline).getAllByTestId('activity-diff').map((d) => d.textContent)
    expect(diffs).toContainEqual(expect.stringContaining('roles: Rh Clerk → Rh Clerk, Rh Auditor'))
    expect(diffs).toContainEqual(expect.stringContaining('roles: Rh Clerk, Rh Auditor → Rh Clerk'))
  })
  expect(timeline).toHaveTextContent('Administrator')
})
