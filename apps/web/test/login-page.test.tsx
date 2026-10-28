// The sign-in page in plain words (OpenSpec change
// `quiet-test-mode-and-friendly-sign-in-refusals`): a refused Google sign-in
// comes back as a short code the page explains, nothing typed is a slip the
// page names itself, and a raw server validation message is never shown.
import { describe, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
  // #474: on the panel the service is offered by its own button, so the
  // sentence does not repeat it.
  const button = await screen.findByTestId('refused-delegated')
  expect(button).toHaveTextContent('Sign in with StyleHR')
  const sentence = screen.getByTestId('sign-in-refused')
  expect(sentence).toHaveTextContent("This Google account isn't set up for")
  expect(sentence).toHaveTextContent(/Ask your manager or IT to invite you\.$/)
  expect(sentence).not.toHaveTextContent('sign in with StyleHR')
  expect(sentence).not.toHaveTextContent('Access not provisioned')
  // Where no panel button offers it, the notice still names the service.
  await userEvent.click(screen.getByTestId('refused-other-ways'))
  expect(screen.getByTestId('sign-in-refused')).toHaveTextContent('Ask your manager or IT to invite you, or sign in with StyleHR.')
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

// #474: a refused Google sign-in shows a panel that offers the next step
// instead of an empty form. The numbers are the agreed spec items on #474.
const RETRY_HREF = '/api/oauth/google/login?prompt=select_account'

/** Inputs a person could type into (hidden ones don't count). */
const typeableInputs = () =>
  Array.from(document.querySelectorAll('input, textarea, select')).filter((el) => (el as HTMLInputElement).type !== 'hidden')

describe('the "We couldn\'t sign you in" panel (#474)', () => {
  test('1, 5: a refusal shows the heading and the plain sentence, and no input until the person chooses', async () => {
    await configureDelegated()
    await renderApp('/featherbase/login?error=not_provisioned', anonymous)
    const panel = await screen.findByTestId('sign-in-refused-panel')
    expect(within(panel).getByRole('heading', { name: "We couldn't sign you in" })).toBeInTheDocument()
    expect(within(panel).getByTestId('sign-in-refused')).toHaveTextContent("This Google account isn't set up for")
    await screen.findByTestId('refused-delegated')
    expect(typeableInputs()).toEqual([])
    expect(screen.queryByTestId('login-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('delegated-login-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('forgot-password')).not.toBeInTheDocument()
  })

  test('2: with StyleHR on, "Sign in with StyleHR" is the primary button and opens the StyleHR form', async () => {
    await configureDelegated()
    await renderApp('/featherbase/login?error=not_provisioned', anonymous)
    const stylehr = await screen.findByTestId('refused-delegated')
    expect(stylehr).toHaveTextContent('Sign in with StyleHR')
    expect(stylehr.className).toContain('bg-action')
    expect(screen.getByTestId('refused-google-retry').className).not.toContain('bg-action')
    await userEvent.click(stylehr)
    expect(await screen.findByTestId('delegated-login-form')).toBeInTheDocument()
    expect(screen.getByLabelText('StyleHR ID')).toBeInTheDocument()
    expect(screen.queryByTestId('sign-in-refused-panel')).not.toBeInTheDocument()
  })

  test('3: "Try another Google account" restarts Google sign-in with the account picker forced', async () => {
    await configureDelegated()
    await renderApp('/featherbase/login?error=not_provisioned', anonymous)
    const retry = await screen.findByTestId('refused-google-retry')
    expect(retry).toHaveTextContent('Try another Google account')
    expect(retry.tagName).toBe('A')
    expect(retry).toHaveAttribute('href', RETRY_HREF)
  })

  test('4: "Other ways to sign in" is a quiet link that reveals the usual methods', async () => {
    await configureDelegated()
    await renderApp('/featherbase/login?error=not_provisioned', anonymous)
    const other = await screen.findByTestId('refused-other-ways')
    // The link renders before /api/brand answers; the StyleHR button in the
    // panel shows that it has, so the methods it reveals are known.
    await screen.findByTestId('refused-delegated')
    expect(other).toHaveTextContent('Other ways to sign in')
    expect(other.className).not.toContain('bg-action')
    await userEvent.click(other)
    expect(await screen.findByTestId('login-form')).toBeInTheDocument()
    expect(screen.getByTestId('google-login')).toBeInTheDocument()
    expect(screen.getByTestId('delegated-login-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('sign-in-refused-panel')).not.toBeInTheDocument()
    // The reason stays in view above the methods.
    expect(screen.getByTestId('sign-in-refused')).toHaveTextContent("This Google account isn't set up for")
  })

  test('6: without StyleHR the Google retry is the primary button', async () => {
    await removeDelegated()
    await renderApp('/featherbase/login?error=not_provisioned', anonymous)
    const panel = await screen.findByTestId('sign-in-refused-panel')
    const retry = within(panel).getByTestId('refused-google-retry')
    expect(retry.className).toContain('bg-action')
    expect(within(panel).queryByTestId('refused-delegated')).not.toBeInTheDocument()
    expect(within(panel).queryByText(/StyleHR/)).not.toBeInTheDocument()
    expect(typeableInputs()).toEqual([])
  })

  test('7: unknown and hostile codes get the panel with the generic message, and nothing of the code', async () => {
    for (const code of ['made-up', '<img src=x onerror=alert(1)>', '__proto__', 'toString']) {
      const view = await renderApp(`/featherbase/login?error=${encodeURIComponent(code)}`, anonymous)
      const panel = await screen.findByTestId('sign-in-refused-panel')
      expect(within(panel).getByRole('heading', { name: "We couldn't sign you in" })).toBeInTheDocument()
      expect(within(panel).getByTestId('sign-in-refused')).toHaveTextContent("Google sign-in didn't finish. Please try again.")
      expect(panel).not.toHaveTextContent(/made-up|onerror|proto|toString/)
      view.unmount()
    }
  })

  test('the panel heading replaces the subtitle, which comes back once the person chooses', async () => {
    await configureDelegated()
    await renderApp('/featherbase/login?error=not_provisioned', anonymous)
    await screen.findByTestId('refused-delegated')
    expect(screen.queryByText('Sign in to your account')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('refused-other-ways'))
    expect(screen.getByText('Sign in to your account')).toBeInTheDocument()
  })

  test('panel buttons are the same size as the form buttons, and the quiet link is an easy tap', async () => {
    await configureDelegated()
    await renderApp('/featherbase/login?error=not_provisioned', anonymous)
    const stylehr = await screen.findByTestId('refused-delegated')
    const retry = screen.getByTestId('refused-google-retry')
    // The form's buttons are sized `w-full justify-center py-2`.
    for (const el of [stylehr, retry]) expect(el.className).toMatch(/(^|\s)py-2(\s|$)/)
    // A control's height to tap (48px on a touch screen, #380 4.5), though it still looks like a link.
    expect(screen.getByTestId('refused-other-ways').className).toMatch(/(^|\s)min-h-control(\s|$)/)
    await userEvent.click(screen.getByTestId('refused-other-ways'))
    expect(screen.getByTestId('login-submit').className).toMatch(/(^|\s)py-2(\s|$)/)
  })

  test('choosing a way in drops the error from the address, so a reload does not bring the panel back', async () => {
    await configureDelegated()
    const path = '/featherbase/login?error=not_provisioned&next=%2Ffeatherbase%2Fadmin'
    for (const choice of ['refused-other-ways', 'refused-delegated']) {
      // The test router keeps its own history; a browser's address bar holds
      // the same URL, so put it there as the browser would.
      window.history.replaceState(null, '', path)
      const view = await renderApp(path, anonymous)
      await userEvent.click(await screen.findByTestId(choice))
      expect(new URLSearchParams(window.location.search).get('error')).toBeNull()
      expect(new URLSearchParams(window.location.search).get('next')).toBe('/featherbase/admin')
      expect(window.location.pathname).toBe('/featherbase/login')
      view.unmount()
    }
  })

  test('no refusal code, no panel: the usual methods show straight away', async () => {
    await renderApp('/featherbase/login', anonymous)
    await screen.findByTestId('login-form')
    expect(screen.queryByTestId('sign-in-refused-panel')).not.toBeInTheDocument()
  })
})

// #380 4.2: the instance's own logo, set in System Settings, leads the page.
describe('the instance logo', () => {
  test('a logo set in System Settings shows above the instance name, in place of the Featherbase mark', async () => {
    const { sql } = await import('server/src/db')
    await sql`insert into file ${sql({ row_id: 'logo-test', file_name: 'store.png', file_url: '/files/abc_store.png', mime_type: 'image/png', is_private: false })}`
    await sql`insert into single_value ${sql({ table_name: 'System Settings', field: 'logo', value: '/files/abc_store.png' })}
      on conflict (table_name, field) do update set value = excluded.value`
    await sql`insert into single_value ${sql({ table_name: 'System Settings', field: 'app_name', value: 'Corner Store' })}
      on conflict (table_name, field) do update set value = excluded.value`
    await renderApp('/featherbase/login', anonymous)
    const logo = await screen.findByTestId('login-logo')
    expect(logo.tagName).toBe('IMG')
    expect(logo).toHaveAttribute('src', '/files/abc_store.png')
    // The name beside it already says whose it is.
    expect(logo).toHaveAttribute('alt', '')
    const name = screen.getByRole('heading', { level: 1, name: 'Corner Store' })
    expect(logo.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByTestId('login-mark')).not.toBeInTheDocument()
    // A logo that will not load falls back to the mark.
    fireEvent.error(logo)
    expect(await screen.findByTestId('login-mark')).toBeInTheDocument()
  })

  test('without a logo the page shows the Featherbase mark', async () => {
    await renderApp('/featherbase/login', anonymous)
    await waitFor(() => expect(document.title).not.toBe(''))
    expect(await screen.findByTestId('login-mark')).toBeInTheDocument()
    expect(screen.queryByTestId('login-logo')).not.toBeInTheDocument()
  })
})
