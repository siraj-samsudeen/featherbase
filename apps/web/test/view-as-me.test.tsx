// #1222 (owner, 17-Nov-2026: "the tester sees every page as the user he is impersonating"): while a
// tester views as someone, every page that means "me" is about that person, never the tester.
// What the server answers as the viewed person is proved in server/test/view-as.test.ts; here, the
// pages' own idea of "me" follows whom the browser views as.
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { getSessionUser, getSignedInUser, setSession, clearSession } from '../src/lib/api'
import { setViewedPerson, viewedPerson, VIEWING_AS_KEY } from '../src/lib/viewing-as'

const WAIT = { timeout: 10_000 }
afterEach(() => setViewedPerson(null))

test('“me” is the viewed person; who signed in stays for the browser’s own things; sign-out forgets both', () => {
  setSession('t', { row_id: 'tester', email: 'tester@example.test', full_name: 'Tess Tester', landing: '/dash/' })
  expect(getSessionUser()?.row_id).toBe('tester')
  setViewedPerson({ row_id: 'asha', full_name: 'Asha Leader' })
  expect(getSessionUser()).toEqual({ row_id: 'asha', email: null, full_name: 'Asha Leader', landing: '/dash/' })
  expect(getSignedInUser()?.row_id).toBe('tester')
  clearSession()
  expect(getSessionUser()).toBeNull()
  expect(viewedPerson()).toBeNull()
})

test('nobody signed in is nobody, whatever the marker says; a marker not naming a person is ignored', () => {
  clearSession()
  setViewedPerson({ row_id: 'asha', full_name: null })
  expect(getSessionUser()).toBeNull()
  for (const raw of ['1', '{"name":"x"}', 'not json']) {
    window.localStorage.setItem(VIEWING_AS_KEY, raw)
    expect(viewedPerson()).toBeNull()
  }
})

test('What You Can See, opened at the tester’s own address, shows the viewed person’s, and its link and address say so', async ({ admin, createUser }) => {
  const person = await createUser({ fullName: 'Vas Person' })
  setViewedPerson({ row_id: person.user!, full_name: 'Vas Person' })
  await renderApp('/featherbase/account/access/Administrator', admin)
  await waitFor(() => expect(screen.getByTestId('access-explanation-heading')).toHaveTextContent('What you can see'), WAIT)
  expect(window.location.pathname).toBe(`/featherbase/account/access/${encodeURIComponent(person.user!)}`)
  const account = await screen.findByTestId('sidebar-group-account', {}, WAIT)
  expect(within(account).getByRole('link', { name: 'What You Can See' })).toHaveAttribute('href', `/featherbase/account/access/${encodeURIComponent(person.user!)}`)
})

for (const [what, address] of [['Sign-in methods', '/featherbase/account/sign-in-methods'], ['Access tokens', '/featherbase/admin/access-tokens']]) {
  test(`${what} are the account’s own: not shown while viewing, never the tester’s`, async ({ admin, createUser }) => {
    const person = await createUser({ fullName: 'Vas Person' })
    setViewedPerson({ row_id: person.user!, full_name: 'Vas Person' })
    await renderApp(address, admin)
    expect(await screen.findByTestId('not-while-viewing', {}, WAIT)).toHaveTextContent(`${what} are not shown while viewing as someone`)
  })
}
