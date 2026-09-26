import { resolve } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach } from 'vitest'
import { discoverPackages } from 'server/src/runtime-packages'
import { saveDoc } from 'server/src/document'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/api'

const TABLE = 'actionproof.work'
const TABLE_PATH = encodeURIComponent(TABLE)

beforeEach(clearSession)

async function installActionProof(admin: { post: (path: string, body: unknown) => Promise<unknown> }) {
  await discoverPackages([resolve('../..', 'runtime-apps/action-proof')])
  await admin.post('/api/install_app', { name: 'actionproof' })
}

test('generic form deletes a fresh app-owned row using the revision it loaded', async ({ admin }) => {
  await installActionProof(admin)
  const row = await saveDoc(TABLE, { row_id: 'fresh-delete', title: 'Remove 37 crates' }, 'Administrator', 'insert')
  const rowId = String(row.row_id)

  await renderApp(`/featherbase/admin/${TABLE_PATH}/${rowId}`, admin)
  expect(await screen.findByDisplayValue('Remove 37 crates')).toBeInTheDocument()

  const user = userEvent.setup()
  await user.click(screen.getByTestId('form-delete'))
  await user.click(screen.getByTestId('delete-row-confirm'))

  expect(await screen.findByTestId('list-view')).toBeInTheDocument()
  expect(await sql`select row_id from actionproof.work where row_id = ${rowId}`).toEqual([])
})

test('generic form refuses a stale app-owned delete and preserves the newer row', async ({ admin }) => {
  await installActionProof(admin)
  const created = await saveDoc(TABLE, { row_id: 'stale-delete', title: 'Original 19 crates' }, 'Administrator', 'insert')
  const rowId = String(created.row_id)
  const loadedRevision = new Date('2000-01-01T00:00:00.000Z')
  await sql`update actionproof.work set updated_at = ${loadedRevision} where row_id = ${rowId}`

  await renderApp(`/featherbase/admin/${TABLE_PATH}/${rowId}`, admin)
  expect(await screen.findByDisplayValue('Original 19 crates')).toBeInTheDocument()

  const newer = await saveDoc(TABLE, {
    row_id: rowId,
    updated_at: loadedRevision,
    title: 'Newer 83 crates',
  }, 'Administrator')
  const newerRevision = newer.updated_at as Date
  expect(newerRevision).toBeInstanceOf(Date)
  expect(newerRevision.getTime()).toBeGreaterThan(loadedRevision.getTime())

  const user = userEvent.setup()
  await user.click(screen.getByTestId('form-delete'))
  await user.click(screen.getByTestId('delete-row-confirm'))

  await waitFor(() => expect(screen.getByTestId('delete-row-error')).toHaveTextContent('has been modified after you loaded it'))
  expect(screen.getByTestId('delete-row-dialog')).toBeInTheDocument()
  expect(await sql`select row_id, title, updated_at from actionproof.work where row_id = ${rowId}`).toEqual([
    { row_id: 'stale-delete', title: 'Newer 83 crates', updated_at: newerRevision },
  ])
})
