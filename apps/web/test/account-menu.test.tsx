// #72: the navbar avatar opens an account menu (user identity, Sign-in
// methods, Log out — #489). Change password moved to the Sign-in methods page,
// the account page every address serves; its modal posts { password } to
// /api/set_password — through the fetch bridge these are real requests into
// the in-process server, inside the test's rolled-back transaction, so the
// suite can prove the password actually changed by logging in with it.

import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Sql } from 'postgres'
import { ACCOUNT_SIGN_IN_METHODS_PATH } from 'shared'
import { test, expect, renderApp } from './pg-test'

async function login(usr: string, pwd: string): Promise<number> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr, pwd }),
  })
  return res.status
}

test('clicking the avatar opens the account menu; Escape and outside click close it', async ({
  admin,
}) => {
  await renderApp('/featherbase/admin', admin)
  const avatar = await screen.findByTestId('session-user')
  await userEvent.click(avatar)

  const menu = await screen.findByTestId('account-menu')
  expect(menu).toHaveTextContent('Administrator')
  expect(screen.getByTestId('account-sign-in-methods')).toBeInTheDocument()
  expect(screen.getByTestId('logout')).toBeInTheDocument()

  // Escape closes.
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument())

  // Reopen; a click outside the menu closes it too.
  await userEvent.click(avatar)
  await screen.findByTestId('account-menu')
  fireEvent.mouseDown(document.body)
  await waitFor(() => expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument())
})

test('Change password submits to /api/set_password and the new password logs in', async ({
  admin,
}) => {
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  await userEvent.click(await screen.findByTestId('account-change-password'))
  await screen.findByTestId('change-password-modal')

  await userEvent.type(screen.getByTestId('change-password-new'), 'rotated-pw-72!')
  await userEvent.type(screen.getByTestId('change-password-confirm'), 'rotated-pw-72!')
  await userEvent.click(screen.getByTestId('change-password-submit'))

  // Success feedback…
  await screen.findByTestId('change-password-done')
  // …and the change is real: the server now accepts the new password and
  // rejects the migration default.
  expect(await login(admin.user!, 'rotated-pw-72!')).toBe(200)
  expect(await login(admin.user!, process.env.ADMIN_PASSWORD ?? 'admin')).toBe(401)

  // Done closes the modal.
  await userEvent.click(screen.getByTestId('change-password-close'))
  await waitFor(() =>
    expect(screen.queryByTestId('change-password-modal')).not.toBeInTheDocument(),
  )
})

test('the sign-in methods page shows an invitation not yet taken up, and a link used once with nothing to name it by', async ({ admin, db }) => {
  await (db as Sql)`insert into sign_in_identity (id, person_id, method, subject, linked_by, last_used_at)
    values ('uid_acct_used', ${admin.user!}, 'google', 'g-acct-1', 'test', now())`
  await (db as Sql)`insert into sign_in_identity (id, person_id, method, subject, pending_email, linked_by)
    values ('uid_acct_invited', ${admin.user!}, 'google', null, 'invited@example.com', 'test')`
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  const used = await screen.findByTestId('method-uid_acct_used', {}, { timeout: 8000 })
  expect(used).toHaveTextContent(/^Google.*— · last used \d/)
  expect(screen.getByTestId('method-uid_acct_invited')).toHaveTextContent('(invited — links at first sign-in)')
})

test('a mismatched confirmation blocks the submit', async ({ admin }) => {
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  await userEvent.click(await screen.findByTestId('account-change-password'))
  await screen.findByTestId('change-password-modal')

  await userEvent.type(screen.getByTestId('change-password-new'), 'one-password')
  await userEvent.type(screen.getByTestId('change-password-confirm'), 'another-password')
  await userEvent.click(screen.getByTestId('change-password-submit'))

  expect(await screen.findByTestId('change-password-error')).toHaveTextContent(
    'Passwords do not match',
  )
  // Still on the form (no success state), and nothing was sent: the typed
  // password does not log in.
  expect(screen.getByTestId('change-password-form')).toBeInTheDocument()
  expect(screen.queryByTestId('change-password-done')).not.toBeInTheDocument()
  expect(await login(admin.user!, 'one-password')).toBe(401)

  // Escape closes the modal.
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() =>
    expect(screen.queryByTestId('change-password-modal')).not.toBeInTheDocument(),
  )
})

// Moved from e2e/account-menu.spec.ts (ACCT-001, #1080): the end of that loop.
const pathOf = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname

test('Log out from the account menu lands on the sign-in page', async ({ admin }) => {
  const r = await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('session-user', {}, { timeout: 8000 }))
  await userEvent.click(screen.getByTestId('logout'))
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/login'))
  expect(await screen.findByTestId('login-submit')).toBeInTheDocument()
})

test('a password the account no longer has is refused on the sign-in form', async ({ admin }) => {
  await renderApp('/featherbase/login', { user: null, token: null } as never)
  await userEvent.type(await screen.findByLabelText('Email or username'), admin.user!)
  await userEvent.type(screen.getByLabelText('Password'), 'not-the-password-anymore')
  await userEvent.click(screen.getByTestId('login-submit'))
  expect(await screen.findByTestId('login-error')).toHaveTextContent('Invalid login credentials')
})

// #1176: under the name, the sign-in THIS session was made with (made-up method, person and ID).
test('the account menu says which sign-in this session used: the method and the ID typed', async ({ createUser }) => {
  const { sql } = await import('server/src/db')
  const { issueSession } = await import('server/src/auth')
  await sql`insert into sign_in_method (row_id, kind, label, enabled, new_person) values ('stylehr', 'delegated_password', 'StyleHR', true, 'refuse')
    on conflict (row_id) do update set label = excluded.label`
  const reader = await createUser({ email: 'menu.reader.with.a.rather.long.address@example.com', roles: [] })
  await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by)
    values ('uid_menu', ${reader.user!}, 'stylehr', 'KL-RR-9004', 'RR-9004', 'test')`
  const issued = await issueSession(reader.user!, { method: 'stylehr', identity: 'uid_menu' })
  await renderApp('/featherbase/account/sign-in-methods', { ...reader, token: issued.token } as never)
  await userEvent.click(await screen.findByTestId('session-user'))
  const how = await screen.findByTestId('account-signed-in-with')
  const value = screen.getByTestId('account-signed-in-value')
  expect([how.textContent, value.textContent, value.getAttribute('title'), value.className.includes('truncate'), screen.getByTestId('account-identity').textContent?.includes('KL-RR')])
    .toEqual(['Signed in with StyleHR', 'RR-9004', 'RR-9004', true, false])
})

test('a session with no recorded sign-in shows the name only, never a guessed label', async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('session-user'))
  await screen.findByTestId('account-menu')
  expect(screen.queryByTestId('account-signed-in-with')).toBeNull()
})
