import { describe, expect } from 'vitest'
import { test } from './pg-test'

// UI-024 / #380: the theme is a per-person preference — light, dark, or follow
// the device — exposed on whoami and set via /api/set_theme. There is one
// colour palette, so there is no palette preference.

describe('UI-024: per-person theme', () => {
  test('follows the device until the person chooses, and is exposed on whoami', async ({ createUser }) => {
    const user = await createUser({ roles: ['System Manager'] })
    const who = await user.get<{ theme: string }>('/api/whoami')
    expect(who.theme).toBe('device')
  })

  test.for(['light', 'dark', 'device'])('persists %s per person (does not affect anyone else)', async (theme, { createUser }) => {
    const user = await createUser({ roles: ['System Manager'] })
    const other = await createUser({ roles: ['System Manager'] })
    const set = await user.fetch('/api/set_theme', {
      method: 'POST',
      body: JSON.stringify({ theme }),
    })
    expect(set.status).toBe(200)

    const who = await user.get<{ theme: string }>('/api/whoami')
    expect(who.theme).toBe(theme)
    expect((await other.get<{ theme: string }>('/api/whoami')).theme).toBe('device')
  })

  test('rejects an invalid theme value', async ({ createUser }) => {
    const user = await createUser({ roles: ['System Manager'] })
    const res = await user.fetch('/api/set_theme', {
      method: 'POST',
      body: JSON.stringify({ theme: 'neon' }),
    })
    expect(res.status).toBe(417)
  })

  test('there is no palette: whoami does not carry one and the endpoint is gone', async ({ createUser }) => {
    const user = await createUser({ roles: ['System Manager'] })
    expect(await user.get<Record<string, unknown>>('/api/whoami')).not.toHaveProperty('palette')
    const res = await user.fetch('/api/set_palette', { method: 'POST', body: JSON.stringify({ palette: 'ivory' }) })
    expect(res.status).toBe(404)
  })
})
