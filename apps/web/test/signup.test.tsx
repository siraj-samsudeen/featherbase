// person-identities (D10): the Login page offers "Create an account" only when
// an administrator has opened sign-up; it asks for a username and a password.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setPasswordMethod } from 'server/test/identity-fixtures'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never

test('closed by default: no way to create an account is offered', async () => {
  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('login-form')
  await waitFor(() => expect(document.title).not.toBe(''))
  expect(screen.queryByTestId('sign-up-toggle')).not.toBeInTheDocument()
})

test('open: a visitor picks a username and a password and is signed in', async () => {
  await setPasswordMethod({ new_person: 'create' })
  await renderApp('/featherbase/login', anonymous)
  await userEvent.click(await screen.findByTestId('sign-up-toggle'))
  expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument() // username and password only
  await userEvent.type(screen.getByLabelText('Username'), 'meena.k')
  await userEvent.type(screen.getByLabelText('Password'), 'meena-pw-1')
  await userEvent.click(screen.getByTestId('sign-up-submit'))
  await screen.findByTestId('session-user')
  expect(JSON.parse(localStorage.getItem('fc_user')!)).toMatchObject({ email: null, full_name: 'meena.k' })
  expect(JSON.parse(localStorage.getItem('fc_user')!).row_id).toMatch(/^usr_/)
})

test('a taken username is said plainly', async () => {
  await setPasswordMethod({ new_person: 'create' })
  await renderApp('/featherbase/login', anonymous)
  await userEvent.click(await screen.findByTestId('sign-up-toggle'))
  await userEvent.type(screen.getByLabelText('Username'), 'administrator')
  await userEvent.type(screen.getByLabelText('Password'), 'whatever-1')
  await userEvent.click(screen.getByTestId('sign-up-submit'))
  expect(await screen.findByTestId('login-error')).toBeInTheDocument()
  expect(localStorage.getItem('fc_token')).toBeNull()
})
