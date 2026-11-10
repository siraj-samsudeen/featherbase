// Working a checklist run when things go wrong, and the two run gestures no
// other test makes. Gaps the merged web coverage report (ADR 0012) showed: a
// run that cannot be opened, a note saved by leaving the box rather than
// pressing Enter, the camera button opening the picker, and a photo the
// server refuses; and a run or a note the network drops. Each refusal is a
// real server answer.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { File as NodeFile } from 'node:buffer'
import { afterEach, vi } from 'vitest'
import { installApp } from 'server/src/apps'
import { sql } from 'server/src/db'
import { deleteStored } from 'server/src/storage'
import { test, expect, renderApp } from './pg-test'
import { pickedFile, useNodeMultipart } from './node-multipart'

type Admin = Parameters<typeof renderApp>[1]

afterEach(() => vi.unstubAllGlobals())

async function seedRun(admin: Admin): Promise<string> {
  const [have] = await sql`select 1 from table_def where name = 'Checklist Run'`
  if (!have) await installApp('checklists')
  const templates = (await admin.get(
    '/api/table/Checklist%20Template?fields=%5B%22row_id%22%5D&limit_page_length=1',
  )) as { data: { row_id: string }[] }
  const run = (await admin.post('/api/save_row', {
    table: 'Checklist Run',
    row: { template: templates.data[0].row_id, store: 'ATK', section: 'Kurti', team_leader: 'Component TL' },
  })) as { row_id: string }
  return run.row_id
}

const runPath = (run: string) => `/featherbase/admin/table/checklist-run/view/checklist?run=${encodeURIComponent(run)}`

async function openRun(admin: Admin, run: string) {
  await renderApp(runPath(run), admin)
  await screen.findByTestId('checklist-run-view', {}, { timeout: 10_000 })
  await waitFor(() => expect(screen.getAllByTestId('checklist-item')).toHaveLength(8))
}

test('a run that does not exist says so, and Back returns to the runs', async ({ admin }) => {
  const user = userEvent.setup()
  await seedRun(admin)
  await renderApp(runPath('no-such-run'), admin)
  expect(await screen.findByText(/not found/i, {}, { timeout: 10_000 })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(await screen.findByTestId('checklist-view')).toBeInTheDocument()
})

test('a note is saved when the person leaves the box, without pressing Enter', async ({ admin }) => {
  const user = userEvent.setup()
  const run = await seedRun(admin)
  await openRun(admin, run)
  const item = () => screen.getAllByTestId('checklist-item')[3]
  await user.click(within(item()).getByTestId('checklist-add-note'))
  await user.type(within(item()).getByTestId('checklist-note-input'), 'Shutter stuck')
  fireEvent.blur(within(item()).getByTestId('checklist-note-input'))
  await waitFor(() => expect(item()).toHaveTextContent('Note: Shutter stuck'))
  const doc = (await admin.get(`/api/table/Checklist%20Run/${encodeURIComponent(run)}`)) as { items: { note: string | null }[] }
  expect(doc.items.map((i) => i.note)).toContain('Shutter stuck')
})

test('note controls wait for a pending save, then allow the next note to persist', async ({ admin }) => {
  const user = userEvent.setup()
  const run = await seedRun(admin)
  await openRun(admin, run)
  const item = (n: number) => within(screen.getAllByTestId('checklist-item')[n])
  await user.click(item(4).getByTestId('checklist-add-note'))
  await user.type(item(4).getByTestId('checklist-note-input'), 'Existing note{Enter}')
  await waitFor(() => expect(item(4).getByTitle('Edit note')).toHaveTextContent('Existing note'))
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let started!: () => void
  const pending = new Promise<void>((resolve) => { started = resolve })
  const real = globalThis.fetch
  let first = true
  const delayed = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await real(input, init)
    if (first && String(input).endsWith('/api/save_row')) {
      first = false
      started()
      await gate
    }
    return response
  })
  try {
    await user.click(item(3).getByTestId('checklist-add-note'))
    await user.type(item(3).getByTestId('checklist-note-input'), 'First note{Enter}')
    await pending
    expect(item(4).getByTitle('Edit note')).toBeDisabled()
    expect(item(6).getByTestId('checklist-add-note')).toBeDisabled()
    await user.click(item(4).getByTitle('Edit note'))
    expect(screen.queryByTestId('checklist-note-input')).not.toBeInTheDocument()
    release()
    await waitFor(() => expect(item(4).getByTitle('Edit note')).toBeEnabled())
    await user.click(item(4).getByTitle('Edit note'))
    await user.clear(item(4).getByTestId('checklist-note-input'))
    await user.type(item(4).getByTestId('checklist-note-input'), 'Second note{Enter}')
    await waitFor(async () => {
      const doc = await admin.get<{ items: { note: string | null }[] }>(`/api/table/Checklist%20Run/${encodeURIComponent(run)}`)
      expect(doc.items[3].note).toBe('First note')
      expect(doc.items[4].note).toBe('Second note')
    })
  } finally {
    release()
    delayed.mockRestore()
  }
})

test('the camera button opens the picker; a photo the server refuses offers a retry', async ({ admin }) => {
  const user = userEvent.setup()
  const run = await seedRun(admin)
  await openRun(admin, run)
  // Not every item asks for a photo; take the first that does.
  const add = screen.getAllByTestId('checklist-photo-add')[0]
  const input = screen.getAllByTestId('checklist-photo-input')[0]
  let opened = 0
  input.addEventListener('click', () => opened++)
  await user.click(add)
  expect(opened).toBe(1)

  // The run is deleted meanwhile, so the item the photo hangs on is gone.
  await admin.delete(`/api/table/Checklist%20Run/${encodeURIComponent(run)}`)
  await useNodeMultipart()
  fireEvent.change(input, { target: { files: [pickedFile('shelf.jpg', 'jpeg bytes', 'image/jpeg')] } })
  await waitFor(() => expect(screen.getAllByTestId('checklist-photo-add')[0]).toHaveTextContent('📷 Retry'))
  const [stored] = await sql`select count(*)::int as n from file where file_name = 'shelf.jpg'`
  expect(stored.n).toBe(0)
})

test('a photo picker closed without a photo uploads nothing', async ({ admin }) => {
  const run = await seedRun(admin)
  await openRun(admin, run)
  const input = screen.getAllByTestId('checklist-photo-input')[0]
  fireEvent.change(input, { target: { files: [] } })
  expect(screen.getAllByTestId('checklist-photo-add')[0]).toHaveTextContent('📷 Take photo')
  expect(screen.queryByTestId('checklist-photo-thumb')).not.toBeInTheDocument()
})

test('multiple photos remain attached to their own checklist item', async ({ admin }) => {
  const run = await seedRun(admin)
  const doc = await admin.get<{ items: { row_id: string; photo_proof: boolean }[] }>(
    `/api/table/Checklist%20Run/${encodeURIComponent(run)}`,
  )
  const photoItems = doc.items.filter((item) => item.photo_proof)
  expect(photoItems.length).toBeGreaterThanOrEqual(2)
  await useNodeMultipart()
  const uploaded: string[] = []
  try {
    for (const [filename, item] of [
      ['left-shelf.svg', photoItems[0]],
      ['right-shelf.svg', photoItems[0]],
      ['entrance.svg', photoItems[1]],
    ] as const) {
      // SVG is a valid picked image without a raster thumbnail. Its attachment
      // must still be offered by name instead of disappearing from the item.
      const form = new FormData()
      form.append('file', pickedFile(filename, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>', 'image/svg+xml'))
      form.append('ref_table', 'Checklist Run Item')
      form.append('ref_name', item.row_id)
      form.append('is_private', '1')
      const response = await admin.fetch('/api/upload_file', { method: 'POST', body: form })
      expect(response.status).toBe(201)
      const file = await response.json() as { file_url: string; thumbnail_url: string | null }
      uploaded.push(file.file_url)
      expect(file.thumbnail_url).toBeNull()
    }
    await openRun(admin, run)
    await waitFor(() => expect(screen.getAllByTestId('checklist-photo-thumb')).toHaveLength(3))
    const items = screen.getAllByTestId('checklist-item')
    const first = within(items[doc.items.indexOf(photoItems[0])])
    const second = within(items[doc.items.indexOf(photoItems[1])])
    expect(first.getAllByTestId('checklist-photo-thumb').map((button) => button.getAttribute('aria-label'))).toEqual([
      'View left-shelf.svg', 'View right-shelf.svg',
    ])
    expect(second.getAllByTestId('checklist-photo-thumb').map((button) => button.getAttribute('aria-label'))).toEqual([
      'View entrance.svg',
    ])
    expect(first.getByRole('button', { name: 'View right-shelf.svg' })).toHaveTextContent('📎')
    await userEvent.click(first.getByRole('button', { name: 'View right-shelf.svg' }))
    const viewer = await screen.findByRole('dialog', { name: 'Photo viewer' })
    expect(await within(viewer).findByRole('img', { name: 'Checklist photo' })).toHaveAttribute(
      'src', expect.stringContaining(`${uploaded[1]}?expires=`),
    )
    await userEvent.click(within(viewer).getByRole('button', { name: 'Close photo' }))
    expect(screen.queryByRole('dialog', { name: 'Photo viewer' })).not.toBeInTheDocument()
  } finally {
    // Database rows roll back; uploaded disk objects do not.
    for (const url of uploaded) await deleteStored(url)
  }
})

// Moved from e2e/checklist.spec.ts (#1080): a camera upload of a real PNG
// shows its thumbnail, and tapping it opens the photo. Making the thumbnail
// needs the server's headless browser (apps/server/test/thumbnails.test.ts),
// so the stored preview is written directly and the run opened again.
test('a photo_proof item takes a camera upload and shows its thumbnail', async ({ admin }) => {
  const run = await seedRun(admin)
  await openRun(admin, run)
  await useNodeMultipart()
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  fireEvent.change(screen.getAllByTestId('checklist-photo-input')[0], {
    target: { files: [new NodeFile([png], 'fast-mover.png', { type: 'image/png' })] },
  })
  await waitFor(() => expect(screen.getAllByTestId('checklist-photo-thumb')).toHaveLength(1), { timeout: 20_000 })
  const [file] = await sql<{ file_url: string }[]>`select file_url from file where file_name = 'fast-mover.png'`
  try {
    const preview = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='
    await sql`update file set thumbnail_url = ${preview} where file_name = 'fast-mover.png'`
    cleanup()
    await openRun(admin, run)
    await waitFor(() => expect(screen.getAllByTestId('checklist-photo-thumb')).toHaveLength(1), { timeout: 20_000 })
    const thumb = screen.getByTestId('checklist-photo-thumb')
    expect(within(thumb).getByRole('img', { name: 'fast-mover.png' }).getAttribute('src')).toBe(preview)
    await userEvent.click(thumb)
    const viewer = await screen.findByRole('dialog', { name: 'Photo viewer' })
    expect(await within(viewer).findByRole('img', { name: 'Checklist photo' })).toHaveAttribute(
      'src', expect.stringContaining(`${file.file_url}?expires=`),
    )
    await userEvent.click(within(viewer).getByRole('button', { name: 'Close photo' }))
    expect(screen.queryByRole('dialog', { name: 'Photo viewer' })).not.toBeInTheDocument()
  } finally {
    await deleteStored(file.file_url)
  }
}, 30_000)

/** Requests whose address starts with `prefix` are lost, as offline. */
function dropNetwork(prefix: string) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).startsWith(prefix)
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
}

test('a run the network drops says it could not be loaded', async ({ admin }) => {
  const run = await seedRun(admin)
  dropNetwork(`/api/table/Checklist%20Run/${encodeURIComponent(run)}`)
  await renderApp(runPath(run), admin)
  expect(await screen.findByText('Could not load this run.', {}, { timeout: 10_000 })).toBeInTheDocument()
})

test('a note the network drops says the save failed', async ({ admin }) => {
  const user = userEvent.setup()
  const run = await seedRun(admin)
  await openRun(admin, run)
  const item = () => screen.getAllByTestId('checklist-item')[3]
  await user.click(within(item()).getByTestId('checklist-add-note'))
  await user.type(within(item()).getByTestId('checklist-note-input'), 'Shutter stuck')
  dropNetwork('/api/save_row')
  fireEvent.blur(within(item()).getByTestId('checklist-note-input'))
  expect(await screen.findByText('Save failed')).toBeInTheDocument()
})
