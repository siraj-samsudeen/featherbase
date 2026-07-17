import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { areq } from './helpers'

// UI-024: theme is a per-user preference exposed via whoami and set via
// /api/set_theme.

const USER = 'theme-srv@x.com'

async function cleanup() {
  await sql`delete from tab_user where name = ${USER}`
}

async function token(usr: string, pwd: string): Promise<string> {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr, pwd }),
  })
  return ((await res.json()) as { token: string }).token
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'User', doc: { name: USER, email: USER, enabled: true, roles: [{ role: 'System Manager' }] } }),
  })
  await setUserPassword(USER, 'themepw12345')
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('UI-024: per-user theme', () => {
  it('defaults to light and is exposed on whoami', async () => {
    const t = await token(USER, 'themepw12345')
    const who = (await (await app.request('/api/whoami', { headers: { authorization: `Bearer ${t}` } })).json()) as {
      theme: string
    }
    expect(who.theme).toBe('light')
  })

  it('persists a set theme per user (does not affect other users)', async () => {
    const t = await token(USER, 'themepw12345')
    const auth = { authorization: `Bearer ${t}`, 'content-type': 'application/json' }
    const set = await app.request('/api/set_theme', { method: 'POST', headers: auth, body: JSON.stringify({ theme: 'dark' }) })
    expect(set.status).toBe(200)

    const who = (await (await app.request('/api/whoami', { headers: { authorization: `Bearer ${t}` } })).json()) as { theme: string }
    expect(who.theme).toBe('dark')

    // Administrator is unaffected.
    const adminWho = (await (await areq('/api/whoami')).json()) as { theme: string }
    expect(adminWho.theme).toBe('light')
  })

  it('rejects an invalid theme value', async () => {
    const t = await token(USER, 'themepw12345')
    const res = await app.request('/api/set_theme', {
      method: 'POST',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'neon' }),
    })
    expect(res.status).toBe(417)
  })
})
