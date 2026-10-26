// The sign-in page in plain words (OpenSpec change
// `quiet-test-mode-and-friendly-sign-in-refusals`): a refused Google sign-in
// comes back as a short code the page explains, nothing typed is a slip the
// page names itself, and a raw server validation message is never shown.
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { configureDelegated, removeDelegated } from 'server/test/identity-fixtures'
import { setUserPassword } from 'server/src/auth'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never

const loginCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([u]) => String(u).endsWith('/api/login'))

test('a Google account nobody set up reads plainly and offers the connected service', async () => {
  await configureDelegated()
  await renderApp('/featherbase/login?error=not_provisioned', anonymous)
  const notice = await screen.findByTestId('sign-in-refused')
  // The connected service is named once the page has read the sign-in options.
  await waitFor(() => expect(notice).toHaveTextContent('Ask your manager or IT to invite you, or sign in with StyleHR.'))
  expect(notice).toHaveTextContent("This Google account isn't set up for")
  expect(notice).not.toHaveTextContent('Access not provisioned')
})

test('without a connected service the refusal does not point at one', async () => {
  await removeDelegated()
  await renderApp('/featherbase/login?error=not_provisioned', anonymous)
  const notice = await screen.findByTestId('sign-in-refused')
  expect(notice).toHaveTextContent('Ask your manager or IT to invite you.')
  expect(notice).not.toHaveTextContent('sign in with')
})

test('each refusal code has its own plain message, and an unknown one a generic message', async () => {
  const cases: [string, RegExp][] = [
    ['not_allowed', /This account can't sign in with Google/],
    ['address_in_use', /Another account already uses this Google account's email address/],
    ['google_off', /Google sign-in isn't available right now/],
    ['expired', /The sign-in took too long or was started in another window/],
    ['google_failed', /Google sign-in didn't finish/],
    ['<script>made-up</script>', /Google sign-in didn't finish/],
    // Names every object inherits are not codes (bot review on #468).
    ['__proto__', /Google sign-in didn't finish/],
    ['constructor', /Google sign-in didn't finish/],
    ['hasOwnProperty', /Google sign-in didn't finish/],
  ]
  for (const [code, text] of cases) {
    const view = await renderApp(`/featherbase/login?error=${encodeURIComponent(code)}`, anonymous)
    expect(await screen.findByTestId('sign-in-refused')).toHaveTextContent(text)
    expect(screen.queryByText(/made-up/)).not.toBeInTheDocument()
    view.unmount()
  }
})

test('no refusal code, no refusal notice', async () => {
  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('login-form')
  expect(screen.queryByTestId('sign-in-refused')).not.toBeInTheDocument()
})

test('the password form shows no example values that could pass for filled-in ones', async () => {
  await renderApp('/featherbase/login', anonymous)
  const usr = await screen.findByLabelText('Email or username')
  const pwd = screen.getByLabelText('Password')
  expect(usr).not.toHaveAttribute('placeholder')
  expect(pwd).not.toHaveAttribute('placeholder')
  expect(usr).toHaveAttribute('autocomplete', 'username')
  expect(usr).toHaveAttribute('name', 'email')
  expect(pwd).toHaveAttribute('autocomplete', 'current-password')
  expect(pwd).toHaveAttribute('name', 'password')
})

test('an empty submit says what to enter and sends nothing', async () => {
  const requests = vi.spyOn(globalThis, 'fetch')
  try {
    await renderApp('/featherbase/login', anonymous)
    await screen.findByTestId('login-form')
    requests.mockClear()
    await userEvent.click(screen.getByTestId('login-submit'))
    expect(await screen.findByTestId('login-error')).toHaveTextContent('Enter your email or username and your password.')
    await userEvent.type(screen.getByLabelText('Email or username'), 'someone')
    await userEvent.click(screen.getByTestId('login-submit'))
    expect(screen.getByTestId('login-error')).toHaveTextContent('Enter your email or username and your password.')
    expect(loginCalls(requests)).toEqual([])
  } finally {
    requests.mockRestore()
  }
})

test('a raw server validation message is never shown; a refusal still reads as the server says', async () => {
  const bridge = globalThis.fetch
  let answer = () => Response.json({ error: { type: 'ValidationError', message: 'Expected { usr, pwd }' } }, { status: 417 })
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(input).endsWith('/api/login') ? Promise.resolve(answer()) : bridge(input, init))
  try {
    await renderApp('/featherbase/login', anonymous)
    await userEvent.type(await screen.findByLabelText('Email or username'), 'someone')
    await userEvent.type(screen.getByLabelText('Password'), 'pw')
    await userEvent.click(screen.getByTestId('login-submit'))
    const error = await screen.findByTestId('login-error')
    expect(error).toHaveTextContent('Enter your email or username and your password.')
    expect(error).not.toHaveTextContent('Expected')

    answer = () => Response.json({ error: { type: 'InternalError', message: 'relation "x" does not exist' } }, { status: 500 })
    await userEvent.click(screen.getByTestId('login-submit'))
    await waitFor(() => expect(screen.getByTestId('login-error')).toHaveTextContent('Sign-in failed. Please try again.'))
    expect(screen.getByTestId('login-error')).not.toHaveTextContent('relation')

    answer = () => Response.json({ error: { type: 'AuthenticationError', message: 'Invalid login credentials' } }, { status: 401 })
    await userEvent.click(screen.getByTestId('login-submit'))
    await waitFor(() => expect(screen.getByTestId('login-error')).toHaveTextContent('Invalid login credentials'))
  } finally {
    spy.mockRestore()
  }
})

// Chrome's autofill writes the inputs' DOM values without the keystrokes a
// controlled input listens for; the form reads what is in the boxes.
test('values written straight into the inputs, as autofill does, are what is sent', async ({ createUser }) => {
  const person = await createUser({ email: 'autofill.person@example.com' })
  await setUserPassword(person.user!, 'autofill-pw-1')
  await renderApp('/featherbase/login', anonymous)
  const usr = (await screen.findByLabelText('Email or username')) as HTMLInputElement
  const pwd = screen.getByLabelText('Password') as HTMLInputElement
  usr.value = 'autofill.person@example.com'
  pwd.value = 'autofill-pw-1'
  fireEvent.submit(screen.getByTestId('login-form'))
  await waitFor(() => expect(localStorage.getItem('fc_token')).toBeTruthy())
  expect(JSON.parse(localStorage.getItem('fc_user')!).row_id).toBe(person.user)
})
