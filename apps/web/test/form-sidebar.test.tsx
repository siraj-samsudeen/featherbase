// A row's Collaboration tab (spec: assignments-tags-and-rules, files): what is
// assigned, tagged or attached there is stored, so the row shows it again when
// it is opened afresh. Moved from e2e/form-sidebar.spec.ts (UI-017) and
// e2e/thumbnail.spec.ts (FILE-004). Every request is the real in-process
// server's; "opened afresh" is a second render of the row's address.
import zlib from 'node:zlib'
import { tableSlug } from 'shared'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { sql } from 'server/src/db'
import { deleteStored } from 'server/src/storage'
import { test, expect, renderApp } from './pg-test'
import { pickedFile, useNodeMultipart } from './node-multipart'

const DT = 'Fsb Ticket'
type Admin = Parameters<typeof renderApp>[1]

const stored: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  // Uploads land on disk, outside the rolled-back transaction.
  for (const url of stored.splice(0)) await deleteStored(url).catch(() => {})
})

async function seedRow(admin: Admin, features: string[]): Promise<string> {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  for (const property of features)
    await admin.post('/api/save_row', { table: 'Metadata Override', row: { table_name: DT, property, value: 'true' } })
  const row = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { title: 'sidebar row' } })
  return row.row_id
}

/** Open the row's form on its Collaboration tab, as a fresh page would. */
async function openCollaboration(admin: Admin, rowId: string) {
  cleanup()
  await renderApp(`/featherbase/admin/table/${tableSlug(DT)}/row/${rowId}`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await userEvent.click(await screen.findByRole('tab', { name: 'Collaboration' }))
}

async function attach(file: File) {
  fireEvent.change(await screen.findByTestId('attach-file-input'), { target: { files: [file] } })
}

async function rememberStored(rowId: string) {
  for (const f of await sql`select file_url from file where ref_table = ${DT} and ref_name = ${rowId}`)
    stored.push(String(f.file_url))
}

test('an assignment made on the row is still there when the row is opened again', async ({ admin }) => {
  const rowId = await seedRow(admin, ['enable_assignments'])
  await sql`insert into person ${sql({ row_id: 'psn_fsbmeenafsbmeenafsbm', created_by: 'Administrator', updated_by: 'Administrator', email: 'meena-fsb@example.com', full_name: 'Meena Fsb', enabled: true })}`
  await openCollaboration(admin, rowId)
  const panel = await screen.findByTestId('assignments-panel')
  await userEvent.type(within(panel).getByTestId('assign-to'), 'meena-fsb@example.com')
  await userEvent.click(within(panel).getByTestId('assign-submit'))
  await waitFor(() => expect(within(panel).getByTestId('assignee')).toHaveTextContent('Meena Fsb'))

  await openCollaboration(admin, rowId)
  const reopened = await screen.findByTestId('assignments-panel')
  await waitFor(() => expect(within(reopened).getByTestId('assignee')).toHaveTextContent('Meena Fsb'))
})

test('a tag added on the row is still there when the row is opened again', async ({ admin }) => {
  const rowId = await seedRow(admin, ['enable_tags'])
  await openCollaboration(admin, rowId)
  const panel = await screen.findByTestId('tags-panel')
  await userEvent.type(within(panel).getByTestId('tag-input'), 'urgent')
  await userEvent.click(within(panel).getByTestId('tag-add'))
  await waitFor(() => expect(within(panel).getByTestId('tag-chip')).toHaveTextContent('urgent'))

  await openCollaboration(admin, rowId)
  expect(await within(await screen.findByTestId('tags-panel')).findByTestId('tag-chip')).toHaveTextContent('urgent')
})

test('a tag removed from the row stays removed when the row is opened again', async ({ admin }) => {
  const rowId = await seedRow(admin, ['enable_tags'])
  await admin.post('/api/tags', { table: DT, row_id: rowId, tag: 'urgent' })
  await openCollaboration(admin, rowId)
  const panel = await screen.findByTestId('tags-panel')
  // Removing a tag asks first (#380); the person says yes.
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await userEvent.click(await within(panel).findByRole('button', { name: 'Remove urgent' }))
  await waitFor(() => expect(within(panel).queryByTestId('tag-chip')).not.toBeInTheDocument())

  await openCollaboration(admin, rowId)
  await waitFor(() => expect(screen.getByTestId('tags-panel')).toHaveTextContent('No tags'))
  expect(screen.queryByTestId('tag-chip')).not.toBeInTheDocument()
})

test('a file attached to the row is still listed when the row is opened again', async ({ admin }) => {
  const rowId = await seedRow(admin, ['enable_files'])
  await openCollaboration(admin, rowId)
  await useNodeMultipart()
  await attach(pickedFile('spec.txt', 'sidebar attachment'))
  await waitFor(() => expect(screen.getByTestId('attachment-row')).toHaveTextContent('spec.txt'))
  await rememberStored(rowId)

  await openCollaboration(admin, rowId)
  expect(await screen.findByTestId('attachment-row')).toHaveTextContent('spec.txt')
})

// A real RGB PNG (no dependencies), so the server's resize has an image to decode.
function makePng(w: number, h: number): Buffer {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3
      raw[i] = (x * 255) / w
      raw[i + 1] = (y * 255) / h
      raw[i + 2] = 128
    }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// FILE-004: the preview's size and decoding are the server's
// (apps/server/test/thumbnails.test.ts); here, which rows show one.
test('an attached picture shows its small preview beside its name; a text file shows none', async ({ admin }) => {
  const rowId = await seedRow(admin, ['enable_files'])
  await openCollaboration(admin, rowId)
  await useNodeMultipart()
  await attach(pickedFile('picture.png', makePng(240, 160), 'image/png'))
  const rowOf = (name: string) => screen.getAllByTestId('attachment-row').find((r) => r.textContent?.includes(name))
  await waitFor(() => expect(rowOf('picture.png')).toBeDefined(), { timeout: 15_000 })
  await attach(pickedFile('note.txt', 'not an image'))
  await waitFor(() => expect(rowOf('note.txt')).toBeDefined(), { timeout: 15_000 })
  await rememberStored(rowId)

  expect(within(rowOf('picture.png')!).getByTestId('attachment-thumb').getAttribute('src')).toMatch(/^data:image\/jpeg;base64,/)
  expect(within(rowOf('note.txt')!).queryByTestId('attachment-thumb')).not.toBeInTheDocument()
}, 30_000)
