// #1257: a System Manager sends a person with no way in a "Set your password"
// link from the Person's sign-in panel; the link's page sets the password and
// signs them in.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { setUserPassword } from 'server/src/auth'
import { getSessionUser } from '../src/lib/api'
import { test, expect, renderApp } from './pg-test'
import { rowHref } from 'shared'

type Admin = Parameters<typeof renderApp>[1]
const anonymous = { user: null, token: null } as never
const pathOf = (r: { router: unknown }) => (r.router as { state: { location: { pathname: string } } }).state.location.pathname

async function openPerson(admin: Admin, user: string) {
  await renderApp(rowHref('Person', user), admin)
  return screen.findByTestId('user-sign-in-methods', {}, { timeout: 8000 })
}

async function mailedKey(email: string): Promise<string> {
  const [mail] = await sql`select body from email_sink where mail_to = ${email} and subject = 'Set your password'`
  return new URL(/Set your password here: (\S+)/.exec(String(mail.body))![1]).searchParams.get('key')!
}

test('#1257: a person with no way in is sent a password invite, and the panel shows it', async ({ admin, createUser }) => {
  const ravi = await createUser({ email: 'ravi@partner.test', fullName: 'Ravi Partner' })
  const panel = await openPerson(admin, ravi.user!)
  const invite = await within(panel).findByTestId('password-invite')
  expect(invite).toHaveTextContent('Emails ravi@partner.test a link to set a password. It works once, for 72 hours.')
  await userEvent.click(within(invite).getByRole('button', { name: 'Send password invite' }))

  // This instance has no SMTP server: the panel never says "emailed".
  const notice = await within(panel).findByTestId('user-method-notice')
  expect(notice).toHaveTextContent('Password invite saved to the Email Sink for ravi@partner.test; this instance does not send email.')
  const status = await within(panel).findByTestId('password-invite-status')
  expect(status).toHaveTextContent(/^Saved to the Email Sink .+ · expires .+$/)
  expect(panel).not.toHaveTextContent(/emailed/i)

  const first = await mailedKey('ravi@partner.test')
  await userEvent.click(within(panel).getByRole('button', { name: 'Resend password invite' }))
  await waitFor(async () => {
    const [{ n }] = await sql`select count(*)::int as n from email_sink where mail_to = 'ravi@partner.test'`
    expect(n).toBe(2)
  })
  const [old] = await sql`select voided_at from password_invite where token_hash = encode(sha256(convert_to(${first}, 'UTF8')), 'hex')`
  expect(old.voided_at).not.toBeNull()
})

test('#1257: someone who already has a password is not offered an invite', async ({ admin, createUser }) => {
  const asha = await createUser({ email: 'asha@partner.test' })
  await setUserPassword(asha.user!, 'origpw123')
  const panel = await openPerson(admin, asha.user!)
  await within(panel).findByTestId('user-method-password')
  expect(within(panel).queryByRole('button', { name: /password invite/i })).not.toBeInTheDocument()
})

test('#1257: the link sets the first password, signs the person in, and works once', async ({ admin, createUser }) => {
  const ravi = await createUser({ email: 'link@partner.test', fullName: 'Ravi Link' })
  await admin.post(`/api/people/${ravi.user}/password_invite`, {})
  const key = await mailedKey('link@partner.test')

  const rendered = await renderApp(`/featherbase/set-password?key=${key}`, anonymous)
  const form = await screen.findByTestId('set-password-form', {}, { timeout: 8000 })
  expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument()
  expect(within(form).getByLabelText('Email')).toHaveValue('link@partner.test')
  await userEvent.type(within(form).getByLabelText('New password'), 'chosen-pw-1')
  await userEvent.type(within(form).getByLabelText('Confirm password'), 'chosen-pw-1')
  await userEvent.click(within(form).getByRole('button', { name: 'Set password and sign in' }))

  await waitFor(() => expect(getSessionUser()?.row_id).toBe(ravi.user), { timeout: 8000 })
  await waitFor(() => expect(pathOf(rendered)).not.toBe('/featherbase/set-password'))
  const [row] = await sql`select password_hash from person where row_id = ${ravi.user!}`
  expect(row.password_hash).not.toBeNull()
})

test('#1257: a spent link says so and points to sign-in', async ({ admin, createUser }) => {
  const ravi = await createUser({ email: 'spent@partner.test' })
  await admin.post(`/api/people/${ravi.user}/password_invite`, {})
  const key = await mailedKey('spent@partner.test')
  await sql`update password_invite set used_at = now() where person = ${ravi.user!}`
  await renderApp(`/featherbase/set-password?key=${key}`, anonymous)
  const refused = await screen.findByTestId('set-password-invalid', {}, { timeout: 8000 })
  expect(refused).toHaveTextContent('This invitation link is invalid or has expired. Ask the person who invited you to send a new one.')
  expect(within(refused).getByRole('link', { name: 'Go to sign-in' })).toHaveAttribute('href', '/featherbase/login')
})

test('#1257: saving a new email on the Person shows the invite as cancelled without a reload', async ({ admin, createUser }) => {
  const nina = await createUser({ email: 'nina@partner.test', fullName: 'Nina Second' })
  await admin.post(`/api/people/${nina.user}/password_invite`, {})
  const panel = await openPerson(admin, nina.user!)
  await within(panel).findByTestId('password-invite-status')
  const email = await screen.findByLabelText('Email')
  await userEvent.clear(email)
  await userEvent.type(email, 'nina.changed@partner.test')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(within(panel).getByTestId('password-invite')).toHaveTextContent('The last password invite was cancelled. Emails nina.changed@partner.test'), { timeout: 8000 })
  expect(within(panel).getByRole('button', { name: 'Send password invite' })).toBeInTheDocument()
})

test('#1257: the notice from a send does not outlive the address it names', async ({ admin, createUser }) => {
  const lena = await createUser({ email: 'lena@partner.test', fullName: 'Lena Fourth' })
  const panel = await openPerson(admin, lena.user!)
  await userEvent.click(await within(panel).findByRole('button', { name: 'Send password invite' }))
  expect(await within(panel).findByTestId('user-method-notice')).toHaveTextContent('for lena@partner.test')
  const email = await screen.findByLabelText('Email')
  await userEvent.clear(email)
  await userEvent.type(email, 'lena.changed@partner.test')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(within(panel).getByTestId('password-invite')).toHaveTextContent('cancelled'), { timeout: 8000 })
  expect(within(panel).queryByTestId('user-method-notice')).not.toBeInTheDocument()
})
