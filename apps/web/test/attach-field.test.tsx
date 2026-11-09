// UI-023: Attach and Attach Image fields — upload, preview, saving, clearing.
// Moved from the Playwright attach-field spec (#1080). The upload goes through
// the real in-process server; only whether the browser can decode the image
// it previews (naturalWidth) stays a browser question.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { pickedFile, useNodeMultipart } from './node-multipart'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Ui Attach Dt'
const PATH = '/featherbase/admin/table/ui-attach-dt/row/attach-1'

afterEach(() => vi.unstubAllGlobals())

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title' },
      { column_name: 'photo', column_type: 'Attach Image', label: 'Photo' },
      { column_name: 'doc_file', column_type: 'Attach', label: 'Doc File' },
    ],
  })
  await admin.post('/api/save_row', { table: DT, row: { row_id: 'attach-1', title: 'attach fixture' } })
}

const stored = (admin: Admin) =>
  admin.get<{ photo: string | null; doc_file: string | null }>(`/api/table/${encodeURIComponent(DT)}/attach-1`)

async function open(admin: Admin) {
  await renderApp(PATH, admin)
  await screen.findByTestId('attach-btn-photo', {}, { timeout: 8000 })
}

function pick(column: string, file: File) {
  fireEvent.change(document.querySelector(`[data-attach-input=${column}]`)!, { target: { files: [file] } })
}

test('UI-023: an uploaded image previews from its file URL and leaves the form unsaved', async ({ admin }) => {
  await seed(admin)
  await useNodeMultipart()
  await open(admin)
  pick('photo', pickedFile('avatar.png', 'png bytes', 'image/png'))
  const preview = await screen.findByTestId('attach-preview-photo')
  expect(preview.getAttribute('src')).toMatch(/^\/files\/[0-9a-f]{16}_avatar\.png$/)
  expect(screen.getByTestId('form-status')).toHaveTextContent('Not saved')
})

test('UI-023: a plain Attach upload shows a link by its name, with no preview', async ({ admin }) => {
  await seed(admin)
  await useNodeMultipart()
  await open(admin)
  pick('doc_file', pickedFile('spec.txt', 'attach me'))
  expect(await screen.findByTestId('attach-link-doc_file')).toHaveTextContent('spec.txt')
  expect(screen.queryByTestId('attach-preview-doc_file')).not.toBeInTheDocument()
})

test('UI-023: saving stores both file URLs, and the reopened form shows them', async ({ admin }) => {
  await seed(admin)
  await useNodeMultipart()
  await open(admin)
  pick('photo', pickedFile('avatar.png', 'png bytes', 'image/png'))
  await screen.findByTestId('attach-preview-photo')
  pick('doc_file', pickedFile('spec.txt', 'attach me'))
  await screen.findByTestId('attach-link-doc_file')
  await userEvent.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  const row = await stored(admin)
  expect(row.photo).toMatch(/^\/files\//)
  expect(row.doc_file).toMatch(/^\/files\//)

  cleanup()
  await renderApp(PATH, admin)
  expect(await screen.findByTestId('attach-preview-photo', {}, { timeout: 8000 })).toHaveAttribute('src', row.photo!)
  expect(screen.getByTestId('attach-link-doc_file')).toHaveTextContent('spec.txt')
})

test('UI-023: clearing an image and saving empties only that value', async ({ admin }) => {
  await seed(admin)
  await useNodeMultipart()
  await open(admin)
  pick('photo', pickedFile('avatar.png', 'png bytes', 'image/png'))
  await screen.findByTestId('attach-preview-photo')
  pick('doc_file', pickedFile('spec.txt', 'attach me'))
  await screen.findByTestId('attach-link-doc_file')
  await userEvent.click(screen.getByTestId('form-save'))
  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))

  await userEvent.click(screen.getByTestId('attach-clear-photo'))
  expect(screen.getByTestId('attach-btn-photo')).toBeInTheDocument()
  await userEvent.click(screen.getByTestId('form-save'))
  await waitFor(async () => expect((await stored(admin)).photo).toBeNull())
  expect((await stored(admin)).doc_file).toMatch(/^\/files\//)
})
