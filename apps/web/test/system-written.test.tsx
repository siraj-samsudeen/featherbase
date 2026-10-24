// #432: a Table whose rows only the platform writes (Activity Log here) shows
// no write affordance to anyone, Administrator included — absent, not
// disabled — and its form opens read-only. Driven by the table's meta, so an
// ordinary platform table (Comment) keeps its controls.
import { screen, waitFor } from '@testing-library/react'
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
  await renderApp('/featherbase/admin/Activity%20Log', admin)
  await screen.findByTestId('list-view')
  // The list itself still reads: the seeded row and the report view are there.
  expect(await screen.findByText('seeded for the read-only form')).toBeInTheDocument()
  expect(screen.getByTestId('open-report')).toBeInTheDocument()
  // Permissions stay, so read access can still be granted.
  expect(screen.getByTestId('open-permissions')).toBeInTheDocument()
  for (const id of WRITE_CONTROLS) expect(screen.queryByTestId(id), id).toBeNull()
})

test('an ordinary platform list keeps its New', async ({ admin }) => {
  await renderApp('/featherbase/admin/Comment', admin)
  await screen.findByTestId('list-view')
  expect(await screen.findByTestId('list-new')).toBeInTheDocument()
})

test('an Activity Log row opens read-only, with no Save, Delete or Rename', async ({ admin }) => {
  const id = await seedActivity()
  await renderApp(`/featherbase/admin/Activity%20Log/${id}`, admin)
  const field = await screen.findByDisplayValue('seeded for the read-only form')
  await waitFor(() => expect(field).toBeDisabled())
  for (const control of ['form-save', 'form-delete', 'form-rename'])
    expect(screen.queryByTestId(control), control).toBeNull()
})

test('a new Activity Log form reached by URL cannot be saved', async ({ admin }) => {
  await renderApp('/featherbase/admin/Activity%20Log/new', admin)
  await screen.findByTestId('form-view')
  expect(screen.queryByTestId('form-save')).toBeNull()
})
