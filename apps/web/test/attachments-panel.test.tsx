// FILE-002 through the row form's attachments panel: two files picked are
// both listed and served; removing one takes its row and its stored object,
// and the other still serves. Moved from e2e/attachments.spec.ts (#1080).
// Also: a picker closed with no file, and a list or removal the network drops.
// The storage rules behind it are apps/server/test/files.test.ts.
// Stored objects are real disk files that outlive the rollback, so the test
// removes what it uploaded itself.
import { afterEach, onTestFinished, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { pickedFile, useNodeMultipart } from './node-multipart'
import { deleteStored } from 'server/src/storage'
import { sql } from 'server/src/db'

const DT = 'Atp Note'

afterEach(() => vi.unstubAllGlobals())

test('FILE-002: two attached files are listed and served, and removing one deletes its stored file', async ({ admin, api }) => {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  await admin.post('/api/save_row', { table: 'Metadata Override', row: { table_name: DT, property: 'enable_files', value: 'true' } })
  const { row_id } = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'with files' } })

  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${row_id}`, admin)
  await userEvent.click(await screen.findByRole('tab', { name: 'Collaboration' }))
  const panel = await screen.findByTestId('attachments-panel')
  await waitFor(() => expect(panel).toHaveTextContent('No attachments'))

  await useNodeMultipart()
  const input = within(panel).getByTestId('attach-file-input')
  fireEvent.change(input, { target: { files: [pickedFile('notes.txt', 'first attachment')] } })
  await waitFor(() => expect(within(panel).getAllByTestId('attachment-row')).toHaveLength(1))
  fireEvent.change(input, { target: { files: [pickedFile('photo.png', 'png bytes', 'image/png')] } })
  await waitFor(() => expect(within(panel).getAllByTestId('attachment-row')).toHaveLength(2))

  const link = (name: string) =>
    within(within(panel).getAllByTestId('attachment-row').find((r) => r.textContent?.includes(name))!)
      .getAllByRole('link')[0]
      .getAttribute('href')!
  const notes = link('notes.txt')
  const photo = link('photo.png')
  onTestFinished(async () => {
    for (const url of [notes, photo]) await deleteStored(url).catch(() => {})
  })
  expect(notes).toMatch(/^\/files\//)
  const served = await api.fetch(notes)
  expect(served.status).toBe(200)
  expect(await served.text()).toBe('first attachment')

  await userEvent.click(within(panel).getByRole('button', { name: 'Remove notes.txt' }))
  await waitFor(() => expect(within(panel).getAllByTestId('attachment-row')).toHaveLength(1))
  expect(panel).not.toHaveTextContent('notes.txt')
  expect((await api.fetch(notes)).status).toBe(404)
  expect((await api.fetch(photo)).status).toBe(200)
})

async function openNote(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  await admin.post('/api/save_row', { table: 'Metadata Override', row: { table_name: DT, property: 'enable_files', value: 'true' } })
  const { row_id } = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'with files' } })
  return {
    row_id,
    open: async () => {
      await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${row_id}`, admin)
      await userEvent.click(await screen.findByRole('tab', { name: 'Collaboration' }))
      return screen.findByTestId('attachments-panel')
    },
  }
}

function dropNetwork(lost: (url: string, init?: RequestInit) => boolean) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    lost(String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url), init)
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
}

test('closing the file picker without a file attaches nothing', async ({ admin }) => {
  const { open } = await openNote(admin)
  const panel = await open()
  await waitFor(() => expect(panel).toHaveTextContent('No attachments'))
  fireEvent.change(within(panel).getByTestId('attach-file-input'), { target: { files: [] } })
  expect(panel).toHaveTextContent('No attachments')
  expect(within(panel).queryByTestId('attach-error')).not.toBeInTheDocument()
})

test('attachments the network drops say they could not be read', async ({ admin }) => {
  const { open } = await openNote(admin)
  dropNetwork((url) => url.startsWith('/api/table/File?'))
  const panel = await open()
  expect(await within(panel).findByRole('alert')).toHaveTextContent('Attachments could not be read.')
})

test('a removal the network drops says the delete failed and keeps the file listed', async ({ admin }) => {
  const { row_id, open } = await openNote(admin)
  await sql`insert into file ${sql({ row_id: 'atp-ghost', ref_table: DT, ref_name: row_id, file_name: 'ghost.txt', file_url: '/files/atp-ghost.txt' })}`
  const panel = await open()
  await waitFor(() => expect(within(panel).getAllByTestId('attachment-row')).toHaveLength(1))
  dropNetwork((url, init) => init?.method === 'DELETE' && url.startsWith('/api/table/File/'))
  await userEvent.click(await within(panel).findByRole('button', { name: 'Remove ghost.txt' }, { timeout: 8000 }))
  expect(await within(panel).findByTestId('attach-error')).toHaveTextContent('Delete failed')
  expect(within(panel).getAllByTestId('attachment-row')).toHaveLength(1)
})
