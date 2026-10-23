import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getDoc, saveDoc } from '../src/document'

// #401: the privacy notice is instance configuration (System Settings
// `privacy_notice`, markdown), not code. Google's consent screen fetches
// /privacy anonymously, so it must answer without a session and must not fall
// into the legacy-path redirect or app-root routing.

async function setNotice(value: string | null) {
  await sql`delete from single_value where table_name = 'System Settings' and field = 'privacy_notice'`
  if (value !== null)
    await sql`insert into single_value ${sql({ table_name: 'System Settings', field: 'privacy_notice', value })}`
}

describe('#401 privacy notice from System Settings', () => {
  test('System Settings carries a long-text privacy_notice field', async () => {
    const [col] = await sql`select column_type from column_def
      where parent = 'System Settings' and column_name = 'privacy_notice'`
    expect(col?.column_type).toBe('Long Text')
  })

  test('GET /privacy is 404 when no notice is configured', async ({ api }) => {
    await setNotice(null)
    const res = await api.fetch('/privacy', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  test('GET /privacy is 404 when the notice is only whitespace', async ({ api }) => {
    await setNotice('  \n ')
    const res = await api.fetch('/privacy', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  test('GET /privacy renders the configured markdown as a public HTML page', async ({ api }) => {
    await setNotice('# Example Org privacy notice\n\nWe hold your **name**.\n\n[Write to us](mailto:privacy@example.org)')
    const res = await api.fetch('/privacy', { redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    const body = await res.text()
    expect(body).toContain('<title>Privacy notice</title>')
    expect(body).toContain('<h1>Example Org privacy notice</h1>')
    expect(body).toContain('<strong>name</strong>')
    expect(body).toContain('<a href="mailto:privacy@example.org">Write to us</a>')
    expect(body).toContain('prefers-color-scheme: dark')
    expect(body).toContain('name="viewport"')
    expect(body.toLowerCase()).not.toContain('<script')
  })

  test('raw HTML and script links in the notice are never rendered live', async ({ api }) => {
    await setNotice('Example Org privacy notice\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))')
    const res = await api.fetch('/privacy', { redirect: 'manual' })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body.toLowerCase()).not.toContain('<script')
    expect(body.toLowerCase()).not.toContain('<img')
    expect(body).not.toContain('href="javascript:')
    expect(body).toContain('&lt;script&gt;')
    expect(body).toMatch(/<meta http-equiv="Content-Security-Policy" content="[^"]*script-src 'none'/)
  })

  test('a notice saved through System Settings is what /privacy shows', async ({ api }) => {
    await setNotice(null)
    await saveDoc('System Settings', { privacy_notice: 'Example Org privacy notice, saved from the form.' }, 'Administrator')
    const doc = await getDoc('System Settings', 'System Settings', 'Administrator')
    expect(doc.privacy_notice).toBe('Example Org privacy notice, saved from the form.')
    const res = await api.fetch('/privacy', { redirect: 'manual' })
    expect(await res.text()).toContain('<p>Example Org privacy notice, saved from the form.</p>')
  })

  test('only a System Manager may change the notice', async ({ client }) => {
    await setNotice(null)
    await expect(
      client.post('/api/save_row', { table: 'System Settings', row: { row_id: 'System Settings', privacy_notice: 'tampered' } }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
