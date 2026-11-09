// The two password forms' refusals: Change password (Sign-in methods page)
// and Reset password (the emailed link). Gaps the merged web coverage report
// (ADR 0012) showed: an empty new password, a mismatched confirmation on the
// reset page, and the server refusing either form or the network dropping it.
// The refusals are the real
// server's answers.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ACCOUNT_SIGN_IN_METHODS_PATH } from 'shared'
import { issueSession } from 'server/src/auth'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

async function openChangePassword(as: Parameters<typeof renderApp>[1]) {
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, as)
  await userEvent.click(await screen.findByTestId('account-change-password', {}, { timeout: 8000 }))
  await screen.findByTestId('change-password-modal')
}

test('Change password with nothing typed asks for a password and sends nothing', async ({ admin }) => {
  await openChangePassword(admin)
  await userEvent.click(screen.getByTestId('change-password-submit'))
  expect(await screen.findByTestId('change-password-error')).toHaveTextContent('Password is required')
  expect(screen.getByTestId('change-password-form')).toBeInTheDocument()
  await userEvent.click(screen.getByTestId('change-password-form'))
  expect(screen.getByTestId('change-password-modal')).toBeInTheDocument()
  await userEvent.click(screen.getByTestId('change-password-modal'))
  expect(screen.queryByTestId('change-password-modal')).not.toBeInTheDocument()
})

test('Change password from a preview sign-in is refused with the reason', async ({ admin }) => {
  // A dev-preview click-through may look around but not change how the
  // account signs in (assertCanChangeAccess).
  const { token } = await issueSession(admin.user!, { preview: true })
  await openChangePassword({ ...admin, token })
  await userEvent.type(screen.getByTestId('change-password-new'), 'x')
  await userEvent.type(screen.getByTestId('change-password-confirm'), 'x')
  await userEvent.click(screen.getByTestId('change-password-submit'))
  expect(await screen.findByTestId('change-password-error')).toHaveTextContent(
    'Not allowed from this sign-in. Sign in again normally to change how this account signs in.',
  )
  expect(screen.queryByTestId('change-password-done')).not.toBeInTheDocument()
})

test('Reset password with a mismatched confirmation says so and sends nothing', async ({ admin }) => {
  await renderApp('/featherbase/reset-password?key=rp-key', admin)
  await userEvent.type(await screen.findByTestId('reset-password'), 'one-password')
  await userEvent.type(screen.getByTestId('reset-confirm'), 'another-password')
  await userEvent.click(screen.getByTestId('reset-submit'))
  expect(await screen.findByTestId('reset-error')).toHaveTextContent('Passwords do not match')
})

test('Reset password with a key the server does not know shows its reason', async ({ admin }) => {
  await renderApp('/featherbase/reset-password?key=no-such-key', admin)
  await userEvent.type(await screen.findByTestId('reset-password'), 'fresh-password-1!')
  await userEvent.type(screen.getByTestId('reset-confirm'), 'fresh-password-1!')
  await userEvent.click(screen.getByTestId('reset-submit'))
  expect(await screen.findByTestId('reset-error')).toHaveTextContent('This reset link is invalid or has expired')
  expect(screen.queryByTestId('reset-done')).not.toBeInTheDocument()
})

/** Requests to `path` are lost, as offline. */
function dropNetwork(path: string) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url) === path
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
}

test('Change password the network drops says the password could not be changed', async ({ admin }) => {
  await openChangePassword(admin)
  await userEvent.type(screen.getByTestId('change-password-new'), 'fresh-password-1!')
  await userEvent.type(screen.getByTestId('change-password-confirm'), 'fresh-password-1!')
  dropNetwork('/api/set_password')
  await userEvent.click(screen.getByTestId('change-password-submit'))
  expect(await screen.findByTestId('change-password-error')).toHaveTextContent('Could not change password')
})

test('Reset password the network drops says the password could not be reset', async ({ admin }) => {
  await renderApp('/featherbase/reset-password?key=rp-key', admin)
  await userEvent.type(await screen.findByTestId('reset-password'), 'fresh-password-1!')
  await userEvent.type(screen.getByTestId('reset-confirm'), 'fresh-password-1!')
  dropNetwork('/api/reset_password')
  await userEvent.click(screen.getByTestId('reset-submit'))
  expect(await screen.findByTestId('reset-error')).toHaveTextContent('Could not reset password')
})
