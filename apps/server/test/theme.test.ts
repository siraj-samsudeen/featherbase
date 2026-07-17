import { describe, expect } from 'vitest'
import { test } from './pg-test'

// UI-024: theme is a per-user preference exposed via whoami and set via
// /api/set_theme.

describe('UI-024: per-user theme', () => {
  test('defaults to light and is exposed on whoami', async ({ createUser }) => {
    const user = await createUser({ roles: ['System Manager'] })
    const who = await user.get<{ theme: string }>('/api/whoami')
    expect(who.theme).toBe('light')
  })

  test('persists a set theme per user (does not affect other users)', async ({
    createUser,
    admin,
  }) => {
    const user = await createUser({ roles: ['System Manager'] })
    const set = await user.fetch('/api/set_theme', {
      method: 'POST',
      body: JSON.stringify({ theme: 'dark' }),
    })
    expect(set.status).toBe(200)

    const who = await user.get<{ theme: string }>('/api/whoami')
    expect(who.theme).toBe('dark')

    // Administrator is unaffected.
    const adminWho = await admin.get<{ theme: string }>('/api/whoami')
    expect(adminWho.theme).toBe('light')
  })

  test('rejects an invalid theme value', async ({ createUser }) => {
    const user = await createUser({ roles: ['System Manager'] })
    const res = await user.fetch('/api/set_theme', {
      method: 'POST',
      body: JSON.stringify({ theme: 'neon' }),
    })
    expect(res.status).toBe(417)
  })
})
