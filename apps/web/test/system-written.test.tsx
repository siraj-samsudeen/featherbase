// #432: a Table whose rows only the platform writes (Activity Log here) shows
// no write affordance to anyone, Administrator included — absent, not
// disabled — and its form opens read-only. Driven by the table's meta, so an
// ordinary platform table (Comment) keeps its controls.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach } from 'vitest'
import { logActivity } from 'server/src/audit'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/api'

beforeEach(clearSession)

const WRITE_CONTROLS = [
  'list-new',
  'list-empty-new',
  'open-import',
  'open-columns',
  'open-merge',
  'open-naming',
  'delete-table',
  'select-all',
]

async function seedActivity(): Promise<string> {
  await logActivity('Administrator', 'seeded for the read-only form')
  const [row] = await sql`select row_id from activity_log where operation = 'seeded for the read-only form' limit 1`
  return String(row.row_id)
}

test('the Activity Log list offers no way to write, even to the Administrator', async ({ admin }) => {
  await seedActivity()
  await renderApp('/featherbase/admin/table/activity-log', admin)
  await screen.findByTestId('list-view')
  // The list itself still reads: the seeded row and the report view are there.
  expect(await screen.findByText('seeded for the read-only form')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'View: List' }))
  expect(screen.getByTestId('open-report')).toBeInTheDocument()
  // Permissions stay, so read access can still be granted.
  await userEvent.click(screen.getByRole('button', { name: 'Table administration' }))
  expect(screen.getByTestId('open-permissions')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'List actions' })).not.toBeInTheDocument()
  for (const id of WRITE_CONTROLS) expect(screen.queryByTestId(id), id).toBeNull()
})

test('an ordinary platform list keeps its New', async ({ admin }) => {
  await renderApp('/featherbase/admin/table/comment', admin)
  await screen.findByTestId('list-view')
  expect(await screen.findByTestId('list-new')).toBeInTheDocument()
})

// The Save, Delete and Rename controls are proven by permissions-and-roles' "Signing in is still recorded".
test('an Activity Log row opens read-only, showing its values rather than boxes', async ({ admin }) => {
  const id = await seedActivity()
  await renderApp(`/featherbase/admin/table/activity-log/row/${id}`, admin)
  // #795: a read-only row shows its values, not disabled boxes.
  await screen.findByText('seeded for the read-only form')
  expect(within(screen.getByTestId('form-arranged')).queryAllByRole('textbox')).toHaveLength(0)
})

test('a new Activity Log form reached by URL cannot be saved', async ({ admin }) => {
  await renderApp('/featherbase/admin/table/activity-log/new', admin)
  await screen.findByTestId('form-view')
  expect(screen.queryByTestId('form-save')).toBeNull()
})
