// #380 task 4.2: the instance's own logo on the sign-in page. System Settings
// has a Logo image; the public /api/brand names it only when it is a public
// file this instance serves, because the sign-in page is read before anyone
// signs in.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { deleteStored } from '../src/storage'
import { test } from './pg-test'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function uploadLogo(as: TestClient, extra: Record<string, string> = {}): Promise<string> {
  const form = new FormData()
  form.append('file', new File([Buffer.from(PNG, 'base64')], 'logo.png', { type: 'image/png' }))
  form.append('ref_table', 'System Settings')
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  const res = await as.fetch('/api/upload_file', { method: 'POST', body: form })
  expect(res.status).toBe(201)
  return ((await res.json()) as { file_url: string }).file_url
}

const brand = async (api: TestClient) => (await (await api.fetch('/api/brand')).json()) as { app_name: string; logo: string | null }

describe('the instance logo on the sign-in page', () => {
  test('System Settings has a Logo image, after the other settings', async () => {
    const [col] = await sql`select label, column_type from column_def where parent = 'System Settings' and column_name = 'logo'`
    expect(col).toEqual({ label: 'Logo', column_type: 'Attach Image' })
  })

  test('no logo set: the brand names none', async ({ api }) => {
    expect((await brand(api)).logo).toBeNull()
  })

  test('a public image set as the logo is named by the brand and opens without signing in', async ({ admin, api }) => {
    const url = await uploadLogo(admin)
    try {
      await admin.post('/api/save_row', { table: 'System Settings', row: { logo: url } })
      expect((await brand(api)).logo).toBe(url)
      const res = await api.fetch(url)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/png')
    } finally {
      await deleteStored(url).catch(() => {})
    }
  })

  test('a private file, or anything that is not a file this instance serves, is never named before sign-in', async ({ admin, api }) => {
    const priv = await uploadLogo(admin, { is_private: '1' })
    try {
      for (const logo of [priv, 'https://elsewhere.example/logo.png', '//elsewhere.example/logo.png', '/files/../private/files/x.png', 'javascript:alert(1)']) {
        await admin.post('/api/save_row', { table: 'System Settings', row: { logo } })
        expect((await brand(api)).logo, logo).toBeNull()
      }
    } finally {
      await deleteStored(priv).catch(() => {})
    }
  })
})
