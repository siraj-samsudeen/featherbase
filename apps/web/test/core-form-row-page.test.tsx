// The behaviour the Playwright core-form-responsive spec walked through on its
// way to measuring the row page at 375px and 1440px (#1080). The measuring is
// layout work and waits for a layout test; what the person can do on the page
// is here, against the in-process server. Realtime arrives through
// realtime-bridge.ts, which carries the server's own events to the page.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { bridgeRealtime } from './realtime-bridge'
import { pickedFile, useNodeMultipart } from './node-multipart'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Cfr Stock Review'
const NAME = 'Stock-review-with-a-long-unbroken-identifier-3783'
const PATH = `/featherbase/admin/table/cfr-stock-review/row/${NAME}`
const url = `/api/table/${encodeURIComponent(DT)}/${NAME}`
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`)!

let stopRealtime: (() => void) | undefined
afterEach(() => {
  stopRealtime?.()
  stopRealtime = undefined
  vi.unstubAllGlobals()
})

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', reqd: true },
      { column_name: 'qty', column_type: 'Int', label: 'Cartons' },
      { column_name: 'notes', column_type: 'Text', label: 'Notes' },
    ],
  })
  await admin.post('/api/save_row', {
    table: 'Metadata Override',
    row: { table_name: DT, property: 'enable_files', value: 'true' },
  })
  await admin.post(`/api/table/${encodeURIComponent(DT)}`, {
    row_id: NAME, title: 'Southern 37 cartons', qty: 83, notes: 'Keep **this** description',
  })
}

async function open(admin: Admin) {
  await renderApp(PATH, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  await waitFor(() => expect(field('title')).toHaveValue('Southern 37 cartons'))
}

test('a save made elsewhere while the row is open says so, and Refresh brings it in', async ({ admin }) => {
  await seed(admin)
  stopRealtime = bridgeRealtime()
  await open(admin)
  await waitFor(() => expect(document.documentElement.dataset.realtimeChannels).toContain(`row:${DT}:${NAME}`))
  const prior = await admin.get<Record<string, unknown>>(url)
  await admin.post('/api/save_row', { table: DT, row: { ...prior, title: 'Other session 83 crates' } })
  expect(await screen.findByTestId('stale-banner')).toHaveTextContent('changed in another session')
  await userEvent.click(screen.getByTestId('stale-refresh'))
  await waitFor(() => expect(field('title')).toHaveValue('Other session 83 crates'))
  await waitFor(() => expect(screen.queryByTestId('stale-banner')).not.toBeInTheDocument())
})

test('Enter on the focused Save button saves the edit, leaving the other fields as they were', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await open(admin)
  fireEvent.change(field('title'), { target: { value: 'Northern crates' } })
  screen.getByTestId('form-save').focus()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  expect(await admin.get(url)).toMatchObject({ title: 'Northern crates', qty: 83, notes: 'Keep **this** description' })
})

test('Collaboration holds the attachments and Form the fields, and switching keeps the edit', async ({ admin }) => {
  await seed(admin)
  await open(admin)
  fireEvent.change(field('title'), { target: { value: 'unsaved edit' } })
  expect(screen.getByTestId('form-arranged')).toBeVisible()
  expect(await screen.findByTestId('attachments-panel')).not.toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: 'Collaboration' }))
  expect(screen.getByTestId('attachments-panel')).toBeVisible()
  expect(screen.getByTestId('form-arranged')).not.toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: 'Form' }))
  await waitFor(() => expect(field('title')).toHaveValue('unsaved edit'))
})

// Presentation only, as the e2e spec stubbed these two answers the same way:
// the real pending and changed-version refusals are runtime-client-identity's.
for (const [status, message] of [
  [403, 'Application pending activation; contact an administrator.'],
  [409, 'Application version changed; reload before saving.'],
] as const) {
  test(`a ${status} refusal of a save shows its message and keeps the edit unsaved`, async ({ admin }) => {
    await seed(admin)
    await open(admin)
    const bridged = globalThis.fetch
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/api/save_row')
        ? Response.json({ error: { type: 'PermissionError', message } }, { status })
        : bridged(input, init)) as typeof fetch)
    fireEvent.change(field('title'), { target: { value: 'Unsaved 37, not 83' } })
    await userEvent.click(screen.getByTestId('form-save'))
    expect(await screen.findByTestId('form-banner')).toHaveTextContent(message)
    expect(field('title')).toHaveValue('Unsaved 37, not 83')
    expect(screen.getByTestId('form-status')).toHaveTextContent('Not saved')
  })

  test(`a ${status} refusal of an upload shows Uploading… meanwhile, then its message`, async ({ admin }) => {
    await seed(admin)
    await useNodeMultipart()
    await open(admin)
    const bridged = globalThis.fetch
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('/api/upload_file')) return bridged(input, init)
      await gate
      return Response.json({ error: { type: 'PermissionError', message } }, { status })
    }) as typeof fetch)
    await userEvent.click(screen.getByRole('tab', { name: 'Collaboration' }))
    const panel = await screen.findByTestId('attachments-panel')
    fireEvent.change(within(panel).getByTestId('attach-file-input'), { target: { files: [pickedFile('stock.txt', '37 cartons, not 83')] } })
    await waitFor(() => expect(within(panel).getByTestId('attach-file')).toHaveTextContent('Uploading…'))
    expect(within(panel).getByTestId('attach-file')).toBeDisabled()
    release()
    expect(await within(panel).findByTestId('attach-error')).toHaveTextContent(message)
  })
}

test('an attachment uploads, its link serves the file, and removing it takes the file away', async ({ admin }) => {
  const fileName = `stock-review-${'x'.repeat(70)}.txt`
  await seed(admin)
  await useNodeMultipart()
  await open(admin)
  await userEvent.click(screen.getByRole('tab', { name: 'Collaboration' }))
  const panel = await screen.findByTestId('attachments-panel')
  fireEvent.change(within(panel).getByTestId('attach-file-input'), { target: { files: [pickedFile(fileName, '37 cartons, not 83')] } })
  const row = await waitFor(() => {
    const found = within(panel).getAllByTestId('attachment-row').find((r) => r.textContent?.includes(fileName))
    expect(found).toBeDefined()
    return found!
  }, { timeout: 8000 })
  const href = row.querySelector('a')!.getAttribute('href')!
  expect(await (await admin.fetch(href)).text()).toBe('37 cartons, not 83')

  // Remove shows once the file's own delete grant has loaded (RemoveAttachment).
  ;(await within(row).findByTestId('attachment-delete')).focus()
  await userEvent.keyboard('{Enter}')
  await waitFor(() => expect(within(panel).queryAllByTestId('attachment-row')).toHaveLength(0))
  expect((await admin.fetch(href)).status).toBe(404)
})
