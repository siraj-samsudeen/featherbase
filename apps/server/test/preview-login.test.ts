import { afterEach, describe, expect, test } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import {
  PREVIEW_KEY_MIN_LENGTH,
  previewKeyMatches,
  previewLogin,
  resolvePreviewLogin,
} from '../src/preview'

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
    await sql`delete from "user" where email = ${email}`
    await sql`
      insert into "user" (row_id, email, full_name, enabled, user_type)
      values (${email}, ${email}, 'Preview Visitor', true, 'website')`
    configure(GOOD_KEY, email)

    const res = await app.request(`/preview?key=${GOOD_KEY}`)
    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    // #150/#173: a session JWT must never ride a URL. What travels is the
    // one-time handoff code, redeemed over POST by the SPA.
    expect(location).toMatch(/^\/oauth-callback\?code=/)
    expect(location).not.toMatch(/eyJ/) // no JWT, which always starts so
    // The browser is bound to the handoff by the sid cookie set here.
    expect(res.headers.get('set-cookie') ?? '').toMatch(/sid=/)

    await sql`delete from "user" where email = ${email}`
  })

  test('a configured user who cannot sign in does not yield a session', async () => {
    // A disabled account is still refused by issueSession — the preview link
    // is a shortcut past the password, not past the account's own state.
    const email = 'preview-disabled@example.com'
    await sql`delete from "user" where email = ${email}`
    await sql`
      insert into "user" (row_id, email, full_name, enabled, user_type)
      values (${email}, ${email}, 'Disabled Visitor', false, 'website')`
    configure(GOOD_KEY, email)

    const res = await app.request(`/preview?key=${GOOD_KEY}`)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/sid=/)

    await sql`delete from "user" where email = ${email}`
  })
})
