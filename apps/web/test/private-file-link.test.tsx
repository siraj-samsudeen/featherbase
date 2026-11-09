// #173: a private file's link carries no credential. It used to be
// `${file_url}?token=<7-day session JWT>`, which lands in history, `Referer`
// and proxy logs; the browser's HttpOnly `sid` cookie authenticates the bare
// URL instead (server/test/files.test.ts, "private uploads require a session
// to read"). Moved down from e2e/private-file-cookie.spec.ts (#1080).
import { screen, waitFor } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { deleteStored } from 'server/src/storage'
import { test, expect, renderApp } from './pg-test'
import { pickedFile, useNodeMultipart } from './node-multipart'

afterEach(() => vi.unstubAllGlobals())

test('#173: a private attachment links to its bare file URL, with no token', async ({ admin }) => {
  await useNodeMultipart()
  const form = new FormData()
  form.append('file', pickedFile('secret.txt', 'classified attachment body'))
  form.append('is_private', '1')
  form.append('ref_table', 'Person')
  form.append('ref_name', 'Guest')
  const uploaded = await admin.fetch('/api/upload_file', { method: 'POST', body: form })
  const { file_url } = (await uploaded.json()) as { file_url: string }
  try {
    expect(file_url).toMatch(/^\/private\/files\//)
    await renderApp('/featherbase/admin/table/person/row/Guest', admin)
    const row = await waitFor(() => {
      const found = screen.getAllByTestId('attachment-row').find((r) => r.textContent?.includes('secret.txt'))
      expect(found).toBeInstanceOf(HTMLElement)
      return found!
    }, { timeout: 8000 })
    const href = row.querySelector('a')!.getAttribute('href')
    expect(href).toBe(file_url)
    expect(href).not.toContain('token=')
  } finally {
    await deleteStored(file_url).catch(() => {})
  }
})
