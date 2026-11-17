// #1255: several signed-in accounts on one browser. The sign-in page opens on
// "Choose an account"; the Account menu lists the others under "Switch to".
// The fetch bridge keeps no cookies, so this file holds the browser's cookies
// itself, as a browser would: `sid` everywhere, `sid_accounts` only on
// /api/accounts.
import { afterEach, beforeEach, describe, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Sql } from 'postgres'
import { issueSession } from 'server/src/auth'
import { test, expect, renderApp } from './pg-test'
import { getToken } from '../src/lib/api'
import { pageLoad } from '../src/lib/page-load'

const anonymous = { user: null, token: null } as never

let jar: Map<string, { value: string; path: string }>
let bridged: typeof fetch
beforeEach(() => {
  jar = new Map()
  bridged = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = /^https?:\/\//.test(url) ? new URL(url).pathname : url.split('?')[0]
    const cookie = [...jar].filter(([, c]) => path.startsWith(c.path)).map(([n, c]) => `${n}=${c.value}`).join('; ')
    const headers = { ...(init.headers as Record<string, string>), ...(cookie ? { cookie } : {}) }
    const res = await bridged(input, { ...init, headers })
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim())
      const name = pair.slice(0, pair.indexOf('='))
      const value = pair.slice(pair.indexOf('=') + 1)
      const cpath = attrs.find((a) => a.toLowerCase().startsWith('path='))?.slice(5) ?? '/'
      if (!value || attrs.some((a) => /^max-age=0$/i.test(a))) jar.delete(name)
      else jar.set(name, { value, path: cpath })
    }
    return res
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = bridged
  vi.restoreAllMocks()
})

/** Sign `person` in on this browser and let the switcher see it, as the page does after a sign-in. */
async function signInHere(person: string) {
  const token = (await issueSession(person)).token
  jar.set('sid', { value: token, path: '/' })
  await fetch('/api/accounts', { method: 'POST' })
  return token
}

async function person(db: Sql, name: string, email: string) {
  const [row] = await db`insert into person (row_id, full_name, email, enabled) values (${`psn_${name.toLowerCase().replace(/\W/g, '')}`}, ${name}, ${email}, true) returning row_id`
  return String(row.row_id)
}

describe('#1255: the sign-in page lists the accounts on this browser', () => {
  test('Choose an account: the last used on top, marked; Use another account opens today\'s form', async ({ db }) => {
    const siraj = await person(db as Sql, 'Siraj Made-up', 'siraj.made-up@example.test')
    const rb = await person(db as Sql, 'RB Made-up', 'rb.made-up@example.test')
    await signInHere(siraj)
    await signInHere(rb)
    jar.delete('sid')
    await renderApp('/featherbase/login', anonymous)
    const chooser = await screen.findByTestId('account-chooser')
    expect(chooser).toHaveTextContent('Choose an account')
    const rows = within(chooser).getAllByTestId('account-choice')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/RB Made-up.*Last used.*rb\.made-up@example\.test/),
      expect.stringMatching(/Siraj Made-up.*siraj\.made-up@example\.test/),
    ])
    expect(rows[1]).not.toHaveTextContent('Last used')
    expect(screen.queryByTestId('login-submit')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('use-another-account'))
    expect(await screen.findByTestId('login-submit')).toBeInTheDocument()
  })

  test('one click continues as a live account, with no password', async ({ db }) => {
    const siraj = await person(db as Sql, 'Siraj Made-up', 'siraj.made-up@example.test')
    const token = await signInHere(siraj)
    jar.delete('sid')
    const load = vi.spyOn(pageLoad, 'assign').mockImplementation(() => {})
    await renderApp('/featherbase/login', anonymous)
    await userEvent.click(await screen.findByRole('button', { name: /Siraj Made-up/ }))
    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(getToken()).toBe(token)
    expect(jar.get('sid')?.value).toBe(token)
  })

  test('an account whose session ended says so, and Sign in opens the form with its ID filled in', async ({ db }) => {
    const siraj = await person(db as Sql, 'Siraj Made-up', 'siraj.made-up@example.test')
    await signInHere(siraj)
    jar.delete('sid')
    await (db as Sql)`update person set enabled = false where row_id = ${siraj}`
    await renderApp('/featherbase/login', anonymous)
    const row = await screen.findByTestId('account-choice')
    expect(row).toHaveTextContent('Signed out: the account was turned off')
    await userEvent.click(within(row).getByRole('button', { name: /Sign in/ }))
    expect(await screen.findByLabelText('Email or username')).toHaveValue('siraj.made-up@example.test')
  })

  test('Remove an account from this list ends its session and drops it', async ({ db }) => {
    const siraj = await person(db as Sql, 'Siraj Made-up', 'siraj.made-up@example.test')
    const rb = await person(db as Sql, 'RB Made-up', 'rb.made-up@example.test')
    await signInHere(siraj)
    const rbToken = await signInHere(rb)
    jar.delete('sid')
    await renderApp('/featherbase/login', anonymous)
    await screen.findByTestId('account-chooser')
    await userEvent.click(screen.getByTestId('remove-accounts'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove RB Made-up' }))
    await waitFor(() => expect(screen.getAllByTestId('account-choice')).toHaveLength(1))
    expect((await fetch('/api/whoami', { headers: { authorization: `Bearer ${rbToken}` } })).status).toBe(401)
  })

  test('with no accounts held the page is today\'s page', async () => {
    await renderApp('/featherbase/login', anonymous)
    expect(await screen.findByTestId('login-submit')).toBeInTheDocument()
    expect(screen.queryByTestId('account-chooser')).not.toBeInTheDocument()
  })

  test('?add=1 opens the form even with accounts held', async ({ db }) => {
    await signInHere(await person(db as Sql, 'Siraj Made-up', 'siraj.made-up@example.test'))
    await renderApp('/featherbase/login?add=1', anonymous)
    expect(await screen.findByTestId('login-submit')).toBeInTheDocument()
    expect(screen.queryByTestId('account-chooser')).not.toBeInTheDocument()
  })

  test('?add=1 with five live accounts shows the list and the limit, not the form', async ({ db }) => {
    for (let i = 0; i < 5; i++) await signInHere(await person(db as Sql, `Person ${'ABCDE'[i]} Made-up`, `p${i}.made-up@example.test`))
    await renderApp('/featherbase/login?add=1', anonymous)
    expect(await screen.findByTestId('accounts-full')).toHaveTextContent('This browser holds 5 accounts, the most it can. Remove one to add another.')
    expect(screen.queryByTestId('login-submit')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Person A Made-up' })).toBeInTheDocument()
  })

  test('each row shows the way in and when it was last used in full, on lines of their own', async ({ db }) => {
    await signInHere(await person(db as Sql, 'Siraj Made-up', 'siraj.made-up@example.test'))
    jar.delete('sid')
    await renderApp('/featherbase/login', anonymous)
    const row = await screen.findByTestId('account-choice')
    expect(within(row).getByTestId('account-way-in')).toHaveTextContent('siraj.made-up@example.test')
    expect(within(row).getByTestId('account-last-used')).toHaveTextContent(/^Used just now$/)
  })
})

describe('#1255: the Account menu switches between them', () => {
  test('Switch to lists the other accounts; one click switches and loads the page as that account', async ({ admin, db }) => {
    const rb = await person(db as Sql, 'RB Made-up', 'rb.made-up@example.test')
    const rbToken = await signInHere(rb)
    jar.set('sid', { value: admin.token!, path: '/' })
    await fetch('/api/accounts', { method: 'POST' })
    const load = vi.spyOn(pageLoad, 'assign').mockImplementation(() => {})
    await renderApp('/featherbase/admin', admin)
    await userEvent.click(await screen.findByTestId('session-user'))
    const section = await screen.findByTestId('account-switcher')
    await waitFor(() => expect(section).toHaveTextContent('Switch to'))
    await userEvent.click(within(section).getByRole('menuitem', { name: /RB Made-up/ }))
    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(getToken()).toBe(rbToken)
  })

  test('with one account the menu offers only + Add another account, which opens the sign-in form', async ({ admin }) => {
    jar.set('sid', { value: admin.token!, path: '/' })
    const load = vi.spyOn(pageLoad, 'assign').mockImplementation(() => {})
    await renderApp('/featherbase/admin', admin)
    await userEvent.click(await screen.findByTestId('session-user'))
    const section = await screen.findByTestId('account-switcher')
    expect(section).not.toHaveTextContent('Switch to')
    expect(section).not.toHaveTextContent('Sign out of all accounts')
    await userEvent.click(within(section).getByRole('menuitem', { name: '+ Add another account' }))
    expect(load).toHaveBeenCalledWith(expect.stringMatching(/^\/featherbase\/login\?add=1&next=/))
  })

  test('Sign out of all accounts ends every session and lands on the plain sign-in page', async ({ admin, db }) => {
    const rbToken = await signInHere(await person(db as Sql, 'RB Made-up', 'rb.made-up@example.test'))
    jar.set('sid', { value: admin.token!, path: '/' })
    await fetch('/api/accounts', { method: 'POST' })
    const load = vi.spyOn(pageLoad, 'assign').mockImplementation(() => {})
    await renderApp('/featherbase/admin', admin)
    await userEvent.click(await screen.findByTestId('session-user'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out of all accounts (2)' }))
    await waitFor(() => expect(load).toHaveBeenCalledWith('/featherbase/login'))
    expect(getToken()).toBeNull()
    expect((await bridged('/api/whoami', { headers: { authorization: `Bearer ${rbToken}` } })).status).toBe(401)
  })

  test('signing out continues as the next held account', async ({ admin, db }) => {
    const rbToken = await signInHere(await person(db as Sql, 'RB Made-up', 'rb.made-up@example.test'))
    jar.set('sid', { value: admin.token!, path: '/' })
    await fetch('/api/accounts', { method: 'POST' })
    const load = vi.spyOn(pageLoad, 'assign').mockImplementation(() => {})
    await renderApp('/featherbase/admin', admin)
    await userEvent.click(await screen.findByTestId('session-user'))
    await userEvent.click(await screen.findByTestId('logout'))
    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(getToken()).toBe(rbToken)
  })
})

describe('#1255: every tab follows the account', () => {
  test('when another tab switches account, this tab reloads', async () => {
    const reload = vi.spyOn(pageLoad, 'reload').mockImplementation(() => {})
    window.dispatchEvent(new StorageEvent('storage', { key: 'fc_token', oldValue: 'a', newValue: 'b' }))
    expect(reload).toHaveBeenCalledTimes(1)
    // A sign-out in another tab, and a sign-in after it, reload this one too.
    window.dispatchEvent(new StorageEvent('storage', { key: 'fc_token', oldValue: 'b', newValue: null }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'fc_token', oldValue: null, newValue: 'c' }))
    expect(reload).toHaveBeenCalledTimes(3)
    window.dispatchEvent(new StorageEvent('storage', { key: 'fc_theme', oldValue: 'a', newValue: 'b' }))
    expect(reload).toHaveBeenCalledTimes(3)
  })
})
