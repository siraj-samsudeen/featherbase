// #1257: a System Manager sends a person with no way in a "Set your password"
// link from the Person's sign-in panel; the link's page sets the password and
// signs them in.
import { afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { setUserPassword } from 'server/src/auth'
import { resolve } from 'node:path'
import { config } from 'server/src/config'
import { discoverPackages } from 'server/src/runtime-packages'
import { parseInstanceAddresses } from 'server/src/instance-addresses'
import { getSessionUser } from '../src/lib/api'
import { test, expect, renderApp } from './pg-test'
import { openLine } from './sign-in-lines'
import { rowHref } from 'shared'

type Admin = Parameters<typeof renderApp>[1]
const anonymous = { user: null, token: null } as never
const pathOf = (r: { router: unknown }) => (r.router as { state: { location: { pathname: string } } }).state.location.pathname

afterEach(async () => {
  // An app installed by a test stays loaded in this process after its rows roll back.
  await discoverPackages([])
  config.instanceAddresses = null
  vi.restoreAllMocks()
})

/** An app open to everyone, installed under the name dash: a person with no
 *  Admin use can open it, so their sign-in belongs on its address. */
async function installDashApp(admin: Admin) {
  expect(await discoverPackages([resolve('../..', 'test-apps/fixtures/dash-stand-in')])).toEqual([])
  await admin.post('/api/install_app', { name: 'dash' })
}

async function openSetPassword(admin: Admin, email: string) {
  const [{ row_id }] = await sql`select row_id from person where email = ${email}`
  await admin.post(`/api/people/${row_id}/password_invite`, {})
  const key = await mailedKey(email)
  const rendered = await renderApp(`/featherbase/set-password?key=${key}`, anonymous)
  const form = await screen.findByTestId('set-password-form', {}, { timeout: 8000 })
  return { rendered, form, key }
}

async function choose(form: HTMLElement, pw: string, confirm = pw) {
  await userEvent.type(within(form).getByLabelText('New password'), pw)
  await userEvent.type(within(form).getByLabelText('Confirm password'), confirm)
  await userEvent.click(within(form).getByRole('button', { name: 'Set password and sign in' }))
}

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
  expect(await within(panel).findByTestId('password-invite')).toHaveTextContent('Not set')
  const dialog = await openLine(panel, 'password-invite')
  expect(dialog).toHaveTextContent('Emails ravi@partner.test a link to set a password. It works once, for 72 hours.')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Send Invite' }))

  // This instance has no SMTP server: the panel never says "emailed".
  const notice = await within(panel).findByTestId('user-method-notice')
  expect(notice).toHaveTextContent('Password invite saved to the Email Sink for ravi@partner.test; this instance does not send email.')
  const status = await within(panel).findByTestId('password-invite-status')
  expect(status).toHaveTextContent(/^Invite saved to the Email Sink .+ · expires .+$/)
  expect(panel).not.toHaveTextContent(/emailed/i)

  const first = await mailedKey('ravi@partner.test')
  const again = await openLine(panel, 'password-invite')
  expect(again).toHaveTextContent('The earlier link stops working.')
  await userEvent.click(within(again).getByRole('button', { name: 'Resend' }))
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
  const password = await within(panel).findByTestId('user-method-password')
  expect(within(password).queryByTestId('sign-in-line-action')).not.toBeInTheDocument()
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
  const [row] = await sql`select (select password_hash from person_credential where person_id = ${ravi.user!}) as password_hash`
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
  await waitFor(() => expect(within(panel).getByTestId('password-invite')).toHaveTextContent('The last password invite was cancelled.'), { timeout: 8000 })
  expect(await openLine(panel, 'password-invite')).toHaveTextContent('Emails nina.changed@partner.test')
})

// #1307: under a busy runner this edited the Email box while the page's reads were still landing, and saved
// before the box held the new address. It now waits on each condition, never on the clock.
test('#1257: the notice from a send does not outlive the address it names', async ({ admin, createUser }) => {
  const lena = await createUser({ email: 'lena@partner.test', fullName: 'Lena Fourth' })
  const { queryClient } = await renderApp(rowHref('Person', lena.user!), admin)
  const panel = await screen.findByTestId('user-sign-in-methods', {}, { timeout: 8000 })
  await userEvent.click(within(await openLine(panel, 'password-invite')).getByRole('button', { name: 'Send Invite' }))
  expect(await within(panel).findByTestId('user-method-notice')).toHaveTextContent('for lena@partner.test')
  // The page has settled: nothing it reads is still on its way.
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  const email = await screen.findByLabelText('Email')
  await userEvent.clear(email)
  await userEvent.type(email, 'lena.changed@partner.test')
  // The box holds the new address before it is saved.
  await waitFor(() => expect(screen.getByLabelText('Email')).toHaveValue('lena.changed@partner.test'))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(within(panel).getByTestId('password-invite')).toHaveTextContent('cancelled'), { timeout: 8000 })
  expect(within(panel).queryByTestId('user-method-notice')).not.toBeInTheDocument()
})

test('#1257: mismatched passwords are caught on the page, and a refused password reads plainly', async ({ admin, createUser }) => {
  await createUser({ email: 'typo@partner.test' })
  const { form } = await openSetPassword(admin, 'typo@partner.test')
  await choose(form, 'chosen-pw-1', 'chosen-pw-2')
  expect(await within(form).findByTestId('set-password-error')).toHaveTextContent('Passwords do not match')
  await userEvent.clear(within(form).getByLabelText('New password'))
  await userEvent.clear(within(form).getByLabelText('Confirm password'))
  await choose(form, 'abc')
  await waitFor(() => expect(within(form).getByTestId('set-password-error')).toHaveTextContent('Password must be at least 6 characters'))
  const [row] = await sql`select (select c.password_hash from person_credential c where c.person_id = person.row_id) as password_hash from person where email = 'typo@partner.test'`
  expect(row.password_hash).toBeNull()
})

test('#1257: someone who belongs on another address is handed off there once the password is set', async ({ admin, createUser }) => {
  config.instanceAddresses = parseInstanceAddresses(
    JSON.stringify([
      { address: 'http://localhost', opens: 'admin', emails: true },
      { address: 'http://dash.example.test', opens: 'dash' },
    ]),
    'test',
  )
  await installDashApp(admin)
  await createUser({ email: 'handoff.invite@partner.test' })
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const navigations = () => errors.mock.calls.filter((c) => /Not implemented: navigation/.test(String(c[0]?.message ?? c[0])))
  const { rendered, form } = await openSetPassword(admin, 'handoff.invite@partner.test')
  await choose(form, 'chosen-pw-1')
  await waitFor(() => expect(navigations()).toHaveLength(1), { timeout: 8000 })
  // Nothing on this address took them anywhere: the hand-off is the way on.
  expect(pathOf(rendered)).toBe('/featherbase/set-password')
})
