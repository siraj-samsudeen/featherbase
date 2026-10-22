// Delegated password sign-in on the Login page (OpenSpec change
// `delegated-password-login`). The page is the real route tree; its fetches
// reach the in-process server inside the test's rolled-back transaction, and
// the provider itself is a stub swapped in through `_setDelegatedFetch`.
import { afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { _setDelegatedFetch } from 'server/src/delegated-login'
import { configureDelegated, linkDelegated, removeDelegated } from 'server/test/identity-fixtures'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never

// person-identities: the connected service is a Sign In Method row and a
// person is linked by an identity carrying their StyleHR login ID.
async function connectStyleHR() {
  await configureDelegated()
}

function providerAnswers(answer: () => Response | Promise<Response>) {
  _setDelegatedFetch((async () => answer()) as typeof fetch)
}

async function submitDelegated(id: string, password: string) {
  await userEvent.click(await screen.findByTestId('delegated-login-toggle'))
  await userEvent.type(screen.getByLabelText('StyleHR ID'), id)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByTestId('delegated-login-submit'))
}

afterEach(() => _setDelegatedFetch(null))

test('no connected service, no second way in', async () => {
  vi.stubEnv('ALLOW_MOCK_OAUTH', '1') // Google is offered only when it can work
  await removeDelegated()
  await renderApp('/featherbase/login', anonymous)
  expect(await screen.findByTestId('google-login')).toBeInTheDocument()
  // /api/brand has answered once the app name is applied; give it the chance.
  await waitFor(() => expect(document.title).not.toBe(''))
  expect(screen.queryByTestId('delegated-login-toggle')).not.toBeInTheDocument()
  vi.unstubAllEnvs()
})

test('a linked Team Leader signs in with their StyleHR ID and lands in the Admin', async ({ createUser }) => {
  await connectStyleHR()
  const tl = await createUser({ email: 'tl.web@example.com' })
  await linkDelegated(tl.user!, 'tl_web_1')
  providerAnswers(() => Response.json({ ok: true }))

  await renderApp('/featherbase/login', anonymous)
  expect(await screen.findByTestId('delegated-login-toggle')).toHaveTextContent('Sign in with StyleHR')
  await submitDelegated('tl_web_1', 'hr-password')

  await screen.findByTestId('session-user')
  expect(JSON.parse(localStorage.getItem('fc_user')!).row_id).toBe(tl.user)
  expect(localStorage.getItem('fc_token')).toBeTruthy()
})

test('wrong password, an outage and a person who has left each read differently', async ({ createUser }) => {
  await connectStyleHR()
  // Linked: an unlinked ID is refused as a wrong password before StyleHR is ever asked.
  const tl = await createUser({ email: 'tl.web2@example.com' })
  await linkDelegated(tl.user!, 'tl_web_2')
  await renderApp('/featherbase/login', anonymous)

  providerAnswers(() => Response.json({}, { status: 401 }))
  await submitDelegated('tl_web_2', 'wrong')
  expect(await screen.findByTestId('login-error')).toHaveTextContent('Invalid login credentials')

  providerAnswers(() => new Response('down', { status: 503 }))
  await userEvent.click(screen.getByTestId('delegated-login-submit'))
  await waitFor(() =>
    expect(screen.getByTestId('login-error')).toHaveTextContent('StyleHR is not responding right now'),
  )

  providerAnswers(() => Response.json({ token: 'x', is_active: false }))
  await userEvent.click(screen.getByTestId('delegated-login-submit'))
  await waitFor(() =>
    expect(screen.getByTestId('login-error')).toHaveTextContent('StyleHR shows this account as no longer active'),
  )
  expect(localStorage.getItem('fc_token')).toBeNull()

  // And back to the ordinary form.
  await userEvent.click(screen.getByTestId('password-login-toggle'))
  expect(screen.getByLabelText('Email or username')).toBeInTheDocument()
})

// Test mode (OpenSpec change `delegated-login-test-mode`): the server skips the
// provider, so the page drops the password box and says why.
test('test mode: a notice, no password field, and an employee code alone signs in', async ({ createUser }) => {
  vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
  try {
    await connectStyleHR()
    const tl = await createUser({ email: 'tl.web.test@example.com' })
    await linkDelegated(tl.user!, 'tl_web_test')
    providerAnswers(() => Response.json({ error: 'the provider must not be asked' }))

    await renderApp('/featherbase/login', anonymous)
    await userEvent.click(await screen.findByTestId('delegated-login-toggle'))
    expect(await screen.findByTestId('delegated-test-mode')).toHaveTextContent('Test mode')
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('StyleHR ID')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Employee code'), tl.user!)
    await userEvent.click(screen.getByTestId('delegated-login-submit'))

    await screen.findByTestId('session-user')
    expect(JSON.parse(localStorage.getItem('fc_user')!).row_id).toBe(tl.user)
  } finally {
    vi.unstubAllEnvs()
  }
})

// Review minor 11.
test('with passwords off, the service form offers no way back to a password form', async () => {
  const { setPasswordMethod } = await import('server/test/identity-fixtures')
  await connectStyleHR()
  await setPasswordMethod({ enabled: false })
  await renderApp('/featherbase/login', anonymous)
  await userEvent.click(await screen.findByTestId('delegated-login-toggle'))
  await screen.findByTestId('delegated-login-form')
  expect(screen.queryByTestId('password-login-toggle')).not.toBeInTheDocument()
  expect(screen.queryByTestId('login-form')).not.toBeInTheDocument()
})

test('forgot password says where service users reset theirs', async () => {
  await connectStyleHR()
  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('delegated-login-toggle')
  await userEvent.click(screen.getByTestId('forgot-password'))
  expect(await screen.findByTestId('forgot-delegated-hint')).toHaveTextContent('StyleHR users reset their password in StyleHR.')
})

test('if the sign-in options cannot be read, Google is still offered', async () => {
  const bridge = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(input).startsWith('/api/brand') ? Promise.reject(new TypeError('offline')) : bridge(input, init))
  try {
    await renderApp('/featherbase/login', anonymous)
    expect(await screen.findByTestId('google-login')).toBeInTheDocument()
    expect(screen.getByTestId('login-form')).toBeInTheDocument()
  } finally {
    spy.mockRestore()
  }
})
