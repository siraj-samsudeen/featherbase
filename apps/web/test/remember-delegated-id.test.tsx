// #1226: the sign-in page remembers the last ID that signed in with a connected
// service (StyleHR) in this browser, so staff type only their password. The
// numbers in test names are the spec checklist items in the issue.
import { afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { _setDelegatedFetch } from 'server/src/delegated-login'
import { configureDelegated, linkDelegated } from 'server/test/identity-fixtures'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never
const KEY = 'fc-delegated-id:stylehr'

function providerAnswers(answer: () => Response) {
  _setDelegatedFetch((async () => answer()) as typeof fetch)
}

/** Every value written to either storage while `run` runs. */
async function storageWrites(run: () => Promise<void>): Promise<string[]> {
  const write = vi.spyOn(Storage.prototype, 'setItem')
  try {
    await run()
    return write.mock.calls.map(([k, v]) => `${k}=${v}`)
  } finally {
    write.mockRestore()
  }
}

afterEach(() => {
  _setDelegatedFetch(null)
  vi.restoreAllMocks()
})

test('1, 2: a successful sign-in remembers the ID, and the password is never stored', async ({ createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'remember.ok@example.com' })
  await linkDelegated(tl.user!, 'emp_remember_1')
  providerAnswers(() => Response.json({ ok: true }))
  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('delegated-login-form')

  const writes = await storageWrites(async () => {
    await userEvent.type(screen.getByLabelText('StyleHR ID'), '  emp_remember_1 ')
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pw-123')
    await userEvent.click(screen.getByTestId('delegated-login-submit'))
    await screen.findByTestId('no-access')
  })

  expect(localStorage.getItem(KEY)).toBe('emp_remember_1')
  expect(writes.filter((w) => w.includes('secret-pw-123'))).toEqual([])
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('secret-pw-123')
})

test('3: a wrong password for the remembered ID keeps it, and the page still signs in as it', async ({ createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'remember.fail@example.com' })
  await linkDelegated(tl.user!, 'emp_remember_2')
  localStorage.setItem(KEY, 'emp_remember_2')
  providerAnswers(() => Response.json({}, { status: 401 }))
  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('delegated-login-form')

  await userEvent.type(screen.getByLabelText('Password'), 'wrong')
  await userEvent.click(screen.getByTestId('delegated-login-submit'))
  await screen.findByTestId('login-error')

  expect(localStorage.getItem(KEY)).toBe('emp_remember_2')
  expect(screen.getByTestId('delegated-signing-in-as')).toHaveTextContent('Signing in as emp_remember_2')
})

test('3: a failed first sign-in leaves nothing remembered', async () => {
  await configureDelegated()
  providerAnswers(() => Response.json({}, { status: 401 }))
  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('delegated-login-form')
  await userEvent.type(screen.getByLabelText('StyleHR ID'), 'nobody_linked')
  await userEvent.type(screen.getByLabelText('Password'), 'wrong')
  await userEvent.click(screen.getByTestId('delegated-login-submit'))
  await screen.findByTestId('login-error')
  expect(localStorage.getItem(KEY)).toBeNull()
})

test('4, 6: a remembered ID reads "Signing in as", with "Not you?" beside it, and the cursor waits in Password', async () => {
  await configureDelegated()
  localStorage.setItem(KEY, 'emp_remembered')
  await renderApp('/featherbase/login', anonymous)
  const form = await screen.findByTestId('delegated-login-form')

  expect(screen.getByTestId('delegated-signing-in-as')).toHaveTextContent('Signing in as emp_remembered')
  // Shown as text, not as a box to edit.
  expect(screen.queryByLabelText('StyleHR ID')).not.toBeInTheDocument()
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Password')))
  const notYou = screen.getByTestId('delegated-forget-id')
  expect(notYou).toHaveTextContent('Not you?')
  expect(notYou).toHaveAttribute('type', 'button')
  expect(form).toHaveFormValues({ delegated_id: 'emp_remembered' })
})

test('5: with nothing remembered the ID box is empty, holds the cursor, and there is no "Not you?"', async () => {
  await configureDelegated()
  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('delegated-login-form')
  const id = screen.getByLabelText('StyleHR ID') as HTMLInputElement
  expect(id.value).toBe('')
  await waitFor(() => expect(document.activeElement).toBe(id))
  expect(screen.queryByTestId('delegated-forget-id')).not.toBeInTheDocument()
})

test('6: "Not you?" forgets the ID and opens an empty ID box with the cursor in it', async () => {
  await configureDelegated()
  localStorage.setItem(KEY, 'emp_someone_else')
  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('delegated-login-form')

  await userEvent.click(screen.getByTestId('delegated-forget-id'))

  const id = screen.getByLabelText('StyleHR ID') as HTMLInputElement
  expect(id.value).toBe('')
  expect(document.activeElement).toBe(id)
  expect(localStorage.getItem(KEY)).toBeNull()
  expect(screen.queryByTestId('delegated-forget-id')).not.toBeInTheDocument()
  expect(screen.queryByTestId('delegated-signing-in-as')).not.toBeInTheDocument()
  // It is a button inside the form, so it must never submit it.
  expect(screen.queryByTestId('login-error')).not.toBeInTheDocument()
})

test('7: storage that cannot be read or written leaves the form working as before', async ({ createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'remember.blocked@example.com' })
  await linkDelegated(tl.user!, 'emp_remember_3')
  providerAnswers(() => Response.json({ ok: true }))
  const blocked = (key: string) => key.startsWith('fc-delegated-id:')
  const read = Storage.prototype.getItem
  const write = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (blocked(key)) throw new DOMException('blocked', 'SecurityError')
    return read.call(this, key)
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (blocked(key)) throw new DOMException('blocked', 'SecurityError')
    return write.call(this, key, value)
  })

  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('delegated-login-form')
  expect((screen.getByLabelText('StyleHR ID') as HTMLInputElement).value).toBe('')
  await userEvent.type(screen.getByLabelText('StyleHR ID'), 'emp_remember_3')
  await userEvent.type(screen.getByLabelText('Password'), 'pw')
  await userEvent.click(screen.getByTestId('delegated-login-submit'))
  await screen.findByTestId('no-access')
})

test('8: the browser password manager still sees one form with a username and a current password', async () => {
  await configureDelegated()
  localStorage.setItem(KEY, 'emp_remembered')
  await renderApp('/featherbase/login', anonymous)
  const form = await screen.findByTestId('delegated-login-form')
  // With an ID remembered the username box is hidden but still in the form,
  // so the password manager files the password under the right ID.
  const id = form.querySelector('input[name="delegated_id"]') as HTMLInputElement
  const pw = screen.getByLabelText('Password')
  expect(id).toHaveAttribute('autocomplete', 'username')
  expect(id.value).toBe('emp_remembered')
  expect(pw).toHaveAttribute('autocomplete', 'current-password')
  expect(pw).toHaveAttribute('type', 'password')
  expect(form).toContainElement(pw)
})

test('9: the email-and-password form is not pre-filled from the remembered ID', async () => {
  await configureDelegated()
  localStorage.setItem(KEY, 'emp_remembered')
  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('delegated-login-form')
  await userEvent.click(screen.getByTestId('password-login-toggle'))
  expect((screen.getByLabelText('Email or username') as HTMLInputElement).value).toBe('')
})
