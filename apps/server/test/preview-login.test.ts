import { afterEach, describe, expect, test, vi } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import {
  PREVIEW_KEY_MIN_LENGTH,
  previewKeyMatches,
  previewLogin,
  resolvePreviewLogin,
} from '../src/preview'
import { test as sandboxTest } from './pg-test'
import { expectSessionCookie, setSessionHours } from './session-cookie-test-utils'

// The preview sign-in link is an authentication bypass, so what is pinned
// here is mostly what it REFUSES. A regression that makes it work more
// eagerly is the dangerous one.

const GOOD_KEY = 'k'.repeat(PREVIEW_KEY_MIN_LENGTH)

function configure(key: string | undefined, user: string | undefined) {
  if (key === undefined) delete process.env.PREVIEW_LOGIN_KEY
  else process.env.PREVIEW_LOGIN_KEY = key
  if (user === undefined) delete process.env.PREVIEW_LOGIN_USER
  else process.env.PREVIEW_LOGIN_USER = user
}

afterEach(() => configure(undefined, undefined))

describe('preview sign-in is off unless deliberately switched on', () => {
  test('no variables at all: off, and not a misconfiguration', () => {
    configure(undefined, undefined)
    expect(resolvePreviewLogin()).toEqual({ login: null, refusal: null })
  })

  test('one variable without the other is refused as incomplete', () => {
    configure(GOOD_KEY, undefined)
    expect(resolvePreviewLogin().refusal).toBe('incomplete')
    configure(undefined, 'preview@example.com')
    expect(resolvePreviewLogin().refusal).toBe('incomplete')
  })

  test('a short key REFUSES rather than degrading to working', () => {
    // The whole point: a guessable key against a route that hands out
    // sessions must not be allowed to run at all.
    configure('too-short', 'preview@example.com')
    expect(resolvePreviewLogin()).toEqual({ login: null, refusal: 'key-too-short' })
    expect(previewLogin()).toBeNull()
  })

  test('Administrator is refused as the preview user', () => {
    // #130 treats Administrator as break-glass; a shared link must not hand
    // it out, whatever else is configured correctly.
    configure(GOOD_KEY, 'Administrator')
    expect(resolvePreviewLogin()).toEqual({ login: null, refusal: 'administrator' })
  })

  test('whitespace does not smuggle a short key past the length floor', () => {
    configure(`  ${'k'.repeat(4)}${' '.repeat(40)}`, 'preview@example.com')
    expect(resolvePreviewLogin().refusal).toBe('key-too-short')
  })

  test('a complete, long, non-Administrator configuration is accepted', () => {
    configure(GOOD_KEY, 'preview@example.com')
    expect(previewLogin()).toEqual({ key: GOOD_KEY, user: 'preview@example.com' })
  })
})

describe('the key is compared as a credential', () => {
  test('an absent, wrong, or differently-lengthed key never matches', () => {
    expect(previewKeyMatches(undefined, GOOD_KEY)).toBe(false)
    expect(previewKeyMatches('', GOOD_KEY)).toBe(false)
    expect(previewKeyMatches(GOOD_KEY.slice(0, -1), GOOD_KEY)).toBe(false)
    expect(previewKeyMatches(GOOD_KEY + 'x', GOOD_KEY)).toBe(false)
    expect(previewKeyMatches(GOOD_KEY.toUpperCase(), GOOD_KEY)).toBe(false)
  })

  test('the exact key matches', () => {
    expect(previewKeyMatches(GOOD_KEY, GOOD_KEY)).toBe(true)
  })
})

describe('the /preview route', () => {
  sandboxTest('preview sign-in gives the sid cookie the configured session lifetime', async ({ api }) => {
    const email = 'preview-session@example.com'
    const id = 'psn_previewsessionaaaaaa' // person-rename: ids are minted psn_ ids, never addresses
    await sql`
      insert into person (row_id, email, full_name, enabled)
      values (${id}, ${email}, 'Preview Session Visitor', true)`
    configure(GOOD_KEY, email)
    void id
    for (const hours of [1, 720]) {
      await setSessionHours(hours)
      const before = Math.floor(Date.now() / 1000)
      const res = await api.fetch(`/preview?key=${GOOD_KEY}`)
      const after = Math.floor(Date.now() / 1000)
      expect(res.status).toBe(302)
      const cookie = expectSessionCookie(res, hours, { before, after })
      const location = res.headers.get('location') as string
      const code = new URLSearchParams(location.split('?')[1] ?? '').get('code')
      const redeemed = await api.fetch('/api/oauth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ code }),
      })
      expect(redeemed.status).toBe(200)
      expect(Object.keys((await redeemed.json()) as object).sort()).toEqual(['token', 'user'])
    }
  })

  test('404s when previews are off — it does not advertise itself', async () => {
    configure(undefined, undefined)
    const res = await app.request(`/preview?key=${GOOD_KEY}`)
    expect(res.status).toBe(404)
  })

  test('404s on a wrong key, telling a guesser nothing', async () => {
    configure(GOOD_KEY, 'Administrator@example.com')
    const res = await app.request('/preview?key=nearly-right')
    // Same answer as "previews are off": no oracle for whether the key
    // was close, or even whether previews exist here.
    expect(res.status).toBe(404)
  })

  test('the right key signs in the named user without the token in the URL', async () => {
    const email = 'preview-signin@example.com'
    const id = 'psn_previewsigninaaaaaaa' // person-rename: ids are minted psn_ ids, never addresses
    await sql`delete from person where email = ${email}`
    await sql`
      insert into person (row_id, email, full_name, enabled)
      values (${id}, ${email}, 'Preview Visitor', true)`
    // person-rename: the link is configured by email (or username); the
    // session goes to that person's minted id.
    configure(GOOD_KEY, email)

    const res = await app.request(`/preview?key=${GOOD_KEY}`)
    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    // #150/#173: a session JWT must never ride a URL. What travels is the
    // one-time handoff code, redeemed over POST by the SPA.
    expect(location).toMatch(/^\/featherbase\/oauth-callback\?code=/)
    expect(location).not.toMatch(/eyJ/) // no JWT, which always starts so
    // The browser is bound to the handoff by the sid cookie set here.
    expect(res.headers.get('set-cookie') ?? '').toMatch(/sid=/)

    await sql`delete from person where email = ${email}`
  })

  test('a configured user who cannot sign in does not yield a session', async () => {
    // A disabled account is still refused by issueSession — the preview link
    // is a shortcut past the password, not past the account's own state.
    const email = 'preview-disabled@example.com'
    const id = 'psn_previewdisabledaaaaa' // person-rename: ids are minted psn_ ids, never addresses
    await sql`delete from person where email = ${email}`
    await sql`
      insert into person (row_id, email, full_name, enabled)
      values (${id}, ${email}, 'Disabled Visitor', false)`
    configure(GOOD_KEY, id)

    const res = await app.request(`/preview?key=${GOOD_KEY}`)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/sid=/)

    await sql`delete from person where email = ${email}`
  })
})

describe('the preview seed (person-rename)', () => {
  sandboxTest('creates the preview person by email with a minted id and System Manager, converges on a re-run, and /preview signs them in', async ({ api }) => {
    const { ensurePreviewPerson } = await import('../src/preview-person')
    const { getRoles } = await import('../src/permissions')
    const email = 'preview-seed@example.com'
    const id = await ensurePreviewPerson(email, 'Preview Visitor', () => {})
    expect(id).toMatch(/^psn_[a-z2-7]{20}$/)
    expect(await getRoles(id)).toContain('System Manager')
    expect(await ensurePreviewPerson(email.toUpperCase(), 'Preview Visitor', () => {})).toBe(id)
    expect(await sql`select count(*)::int as n from person where lower(email) = ${email}`).toEqual([{ n: 1 }])
    configure(GOOD_KEY, email)
    const res = await api.fetch(`/preview?key=${GOOD_KEY}`)
    expect(res.status).toBe(302)
  })

  sandboxTest('a username works too; a name that matches nobody is a 404', async ({ api }) => {
    const { ensurePreviewPerson } = await import('../src/preview-person')
    await ensurePreviewPerson('preview.visitor', 'Preview Visitor', () => {})
    configure(GOOD_KEY, 'Preview.Visitor')
    expect((await api.fetch(`/preview?key=${GOOD_KEY}`)).status).toBe(302)
    configure(GOOD_KEY, 'nobody@example.com')
    expect((await api.fetch(`/preview?key=${GOOD_KEY}`)).status).toBe(404)
  })
})

describe('the boot announcement says once whether preview sign-in is live', () => {
  // Each case loads a fresh copy of the module: the once-only flag is module state.
  async function announceFresh(key: string | undefined, user: string | undefined, calls = 1): Promise<string[]> {
    configure(key, user)
    vi.resetModules()
    const { announcePreviewLogin } = await import('../src/preview')
    const lines: string[] = []
    for (let i = 0; i < calls; i++) announcePreviewLogin((m) => lines.push(m))
    return lines
  }

  test('a refused configuration is reported with its reason, and only the first call speaks', async () => {
    expect(await announceFresh(GOOD_KEY, 'Administrator', 2)).toEqual(['preview sign-in REFUSED: PREVIEW_LOGIN_USER must not be Administrator'])
    expect(await announceFresh('short', 'jo')).toEqual([`preview sign-in REFUSED: PREVIEW_LOGIN_KEY must be at least ${PREVIEW_KEY_MIN_LENGTH} characters`])
    expect(await announceFresh(GOOD_KEY, undefined)).toEqual(['preview sign-in REFUSED: PREVIEW_LOGIN_KEY and PREVIEW_LOGIN_USER must both be set'])
  })

  test('a live configuration names the user, and an unconfigured instance says nothing', async () => {
    expect(await announceFresh(GOOD_KEY, 'jo')).toEqual(['preview sign-in enabled at /preview as jo'])
    expect(await announceFresh(undefined, undefined)).toEqual([])
  })

  test('with no logger given it writes to the console', async () => {
    configure(GOOD_KEY, 'jo')
    vi.resetModules()
    const { announcePreviewLogin } = await import('../src/preview')
    const original = console.log
    const seen: string[] = []
    console.log = (...a: unknown[]) => void seen.push(a.join(' '))
    try {
      announcePreviewLogin()
    } finally {
      console.log = original
    }
    expect(seen).toEqual(['preview sign-in enabled at /preview as jo'])
  })
})
