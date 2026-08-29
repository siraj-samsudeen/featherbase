// #72: the navbar avatar opens an account menu (user identity, Change
// password, Log out). The Change-password modal posts { password } to
// /api/set_password — through the fetch bridge these are real requests into
// the in-process server, inside the test's rolled-back transaction, so the
// suite can prove the password actually changed by logging in with it.

import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  await renderApp('/admin', admin)
  const avatar = await screen.findByTestId('session-user')
  await userEvent.click(avatar)

  const menu = await screen.findByTestId('account-menu')
  expect(menu).toHaveTextContent('Administrator')
  expect(screen.getByTestId('account-change-password')).toBeInTheDocument()
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
  await renderApp('/admin', admin)
  await userEvent.click(await screen.findByTestId('session-user'))
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

test('a mismatched confirmation blocks the submit', async ({ admin }) => {
  await renderApp('/admin', admin)
  await userEvent.click(await screen.findByTestId('session-user'))
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
