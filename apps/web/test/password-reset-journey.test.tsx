// SET-002 through the screens: a person resets their password from the
// sign-in page's Forgot password link and signs in with the new one, and a
// disabled person is refused at the sign-in form. Moved from
// e2e/user-management.spec.ts (#1080). The reset token's own rules (single
// use, expiry, disabled accounts get no mail) are apps/server/test/password-reset.test.ts.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TestClient } from 'feather-testing-postgres'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never
const USER = 'prj-reset@example.com'

async function person(admin: TestClient, enabled: boolean): Promise<string> {
  const role = 'Prj Reader'
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: role } })
  const { row_id } = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Person',
    row: { email: USER, full_name: 'Prj Reset', enabled, roles: [{ role }] },
  })
  await admin.post('/api/set_password', { user: row_id, password: 'initialpw123' })
  return row_id
}

async function signIn(password: string) {
  await userEvent.type(await screen.findByLabelText('Email or username'), USER)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

test('SET-002: a password reset from the emailed link lets the person sign in with the new password', async ({ admin }) => {
  const id = await person(admin, true)
  const user = userEvent.setup()
  const { router } = await renderApp('/featherbase/login', anonymous)
  await user.click(await screen.findByTestId('forgot-password'))
  await user.type(screen.getByTestId('forgot-usr'), USER)
  await user.click(screen.getByTestId('forgot-submit'))
  expect(await screen.findByTestId('reset-sent')).toBeInTheDocument()

  const filters = encodeURIComponent(JSON.stringify([['mail_to', '=', USER]]))
  const mail = await admin.get<{ data: { body: string }[] }>(
    `/api/table/Email%20Sink?filters=${filters}&fields=${encodeURIComponent('["body"]')}`,
  )
  const key = /key=([0-9a-f]+)/.exec(mail.data[0]?.body ?? '')?.[1]
  expect(key).toMatch(/^[0-9a-f]{48}$/)

  await router.navigate({ href: `/featherbase/reset-password?key=${key}` })
  await user.type(await screen.findByTestId('reset-password'), 'brandnewpw456')
  await user.type(screen.getByTestId('reset-confirm'), 'brandnewpw456')
  await user.click(screen.getByTestId('reset-submit'))
  expect(await screen.findByTestId('reset-done')).toBeInTheDocument()
  await user.click(screen.getByTestId('reset-to-login'))

  await signIn('brandnewpw456')
  await waitFor(() => expect(router.state.location.pathname).toMatch(/\/admin/))
  expect(await screen.findByTestId('session-user')).toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem('fc_user')!).row_id).toBe(id)
})

test('SET-002: a disabled person is refused at the sign-in form', async ({ admin }) => {
  await person(admin, false)
  const { router } = await renderApp('/featherbase/login', anonymous)
  await signIn('initialpw123')
  expect(await screen.findByTestId('login-error')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/featherbase/login')
  expect(localStorage.getItem('fc_token')).toBeNull()
})
