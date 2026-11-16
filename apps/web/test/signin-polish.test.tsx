// #1235: the sign-in page and the Sign-in methods page after the 16-Nov UI
// standard (docs/design/specs/signin-account.md). Test names carry the spec's
// item numbers. Items 1 and 6's remembered-ID half live in
// remember-delegated-id.test.tsx; item 7 (the app shell) belongs to #1227.
import { afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { _setDelegatedFetch } from 'server/src/delegated-login'
import { configureDelegated, linkDelegated } from 'server/test/identity-fixtures'
import { VIEWER_ROLE } from 'server/src/sales-target'
import { test, expect, renderApp } from './pg-test'

const anonymous = { user: null, token: null } as never
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

afterEach(() => {
  _setDelegatedFetch(null)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

test('2: the StyleHR form has no subtitle repeating its button', async () => {
  await configureDelegated()
  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('delegated-login-form')
  expect(screen.queryByText('Sign in with StyleHR', { selector: 'p' })).not.toBeInTheDocument()
  expect(screen.getByTestId('delegated-login-submit')).toHaveTextContent('Sign in with StyleHR')
})

test('3: the "same ID and password" line is help text under the ID box, tied to it', async () => {
  await configureDelegated()
  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('delegated-login-form')
  const id = screen.getByLabelText('StyleHR ID')
  const help = screen.getByTestId('delegated-id-help')
  expect(help).toHaveTextContent('Use the same ID and password you use for StyleHR.')
  expect(id).toHaveAttribute('aria-describedby', help.id)
  expect(help).toHaveClass('text-[13px]', 'text-ink-muted')
  expect(before(id, help)).toBe(true)
  expect(before(help, screen.getByLabelText('Password'))).toBe(true)
  expect(screen.getAllByText(/Use the same ID and password/)).toHaveLength(1)
})

test('4, 5: an "or" divider sits between StyleHR and Google; email-and-password is a centred quiet link under them', async () => {
  vi.stubEnv('ALLOW_MOCK_OAUTH', '1')
  await configureDelegated()
  await renderApp('/featherbase/login', anonymous)
  await screen.findByTestId('delegated-login-form')
  const submit = screen.getByTestId('delegated-login-submit')
  const google = await screen.findByTestId('google-login')
  const divider = screen.getByTestId('sign-in-divider')
  expect(divider).toHaveTextContent(/^or$/)
  expect(before(submit, divider)).toBe(true)
  expect(before(divider, google)).toBe(true)
  const other = screen.getByTestId('password-login-toggle')
  expect(before(google, other)).toBe(true)
  expect(other.parentElement).toHaveClass('justify-center')
})

test('6: a wrong password shows an alert inside the card, above the fields, and keeps the typed ID', async ({ createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'polish.fail@example.com' })
  await linkDelegated(tl.user!, 'emp_polish_1')
  _setDelegatedFetch((async () => Response.json({}, { status: 401 })) as typeof fetch)
  await renderApp('/featherbase/login', anonymous)
  const form = await screen.findByTestId('delegated-login-form')
  await userEvent.type(screen.getByLabelText('StyleHR ID'), 'emp_polish_1')
  await userEvent.type(screen.getByLabelText('Password'), 'wrong')
  await userEvent.click(screen.getByTestId('delegated-login-submit'))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Invalid login credentials')
  expect(form).toContainElement(alert)
  expect(before(alert, screen.getByLabelText('StyleHR ID'))).toBe(true)
  expect(screen.getByLabelText('StyleHR ID')).toHaveValue('emp_polish_1')
})

test('6: the email-and-password form shows its refusal the same way', async () => {
  await renderApp('/featherbase/login', anonymous)
  const form = await screen.findByTestId('login-form')
  await userEvent.type(screen.getByLabelText('Email or username'), 'nobody@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'wrong')
  await userEvent.click(screen.getByTestId('login-submit'))
  const alert = await screen.findByRole('alert')
  expect(form).toContainElement(alert)
  expect(before(alert, screen.getByLabelText('Email or username'))).toBe(true)
  expect(screen.getByLabelText('Email or username')).toHaveValue('nobody@example.com')
})

// ── Sign-in methods ──────────────────────────────────────────────────────────

async function viewer(admin: Parameters<typeof renderApp>[1], createUser: (o: { email: string; roles: string[] }) => Promise<Parameters<typeof renderApp>[1]>, email: string) {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: VIEWER_ROLE } })
  return createUser({ email, roles: [VIEWER_ROLE] })
}

test('8: the page title is a 24px page title with Change password beside it', async ({ admin, createUser }) => {
  const me = await viewer(admin, createUser, 'polish.title@example.com')
  await renderApp('/featherbase/account/sign-in-methods', me)
  const title = await screen.findByRole('heading', { level: 1, name: 'Sign-in methods' })
  expect(title).toHaveClass('text-2xl', 'font-semibold')
  expect(screen.getByTestId('account-change-password')).toHaveTextContent('Change password')
})

test('9: removing the password is in a ⋯ menu, in red, and asks first naming the method', async ({ admin, createUser }) => {
  const me = await viewer(admin, createUser, 'polish.remove@example.com')
  await admin.post('/api/set_password', { user: me.user, password: 'polish-pw-1' })
  await configureDelegated()
  await linkDelegated(me.user!, 'emp_polish_keep')
  await renderApp('/featherbase/account/sign-in-methods', me)
  const password = await screen.findByTestId('method-password')
  expect(within(password).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()

  const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  await userEvent.click(within(password).getByRole('button', { name: 'More actions for Password' }))
  const item = await screen.findByRole('menuitem', { name: 'Remove' })
  expect(item).toHaveClass('text-negative')
  await userEvent.click(item)
  expect(ask).toHaveBeenLastCalledWith('Remove Password as a way to sign in?')
  expect(screen.getByTestId('method-password')).toBeInTheDocument()

  await userEvent.click(within(password).getByRole('button', { name: 'More actions for Password' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }))
  await waitFor(() => expect(screen.queryByTestId('method-password')).not.toBeInTheDocument())
})

test('9: ending an identifier is in a ⋯ menu and asks first naming it', async ({ admin, createUser }) => {
  const me = await viewer(admin, createUser, 'polish.end@example.com')
  await renderApp('/featherbase/account/sign-in-methods', me)
  const panel = await screen.findByTestId('person-identifiers')
  await userEvent.click(await within(panel).findByRole('button', { name: 'Add an identifier' }))
  const form = await within(panel).findByTestId('add-identifier-form')
  await userEvent.selectOptions(within(form).getByLabelText('Identifier'), 'phone')
  await userEvent.type(within(form).getByLabelText('Value'), '98470 99999')
  await userEvent.click(within(form).getByRole('button', { name: 'Add' }))
  const phone = await within(panel).findByTestId('identifier-group-phone')
  expect(within(phone).queryByRole('button', { name: 'End' })).not.toBeInTheDocument()

  const ask = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await userEvent.click(within(phone).getByRole('button', { name: 'More actions for Mobile phone +919847099999' }))
  const end = await screen.findByRole('menuitem', { name: 'End' })
  expect(end).toHaveClass('text-negative')
  await userEvent.click(end)
  expect(ask).toHaveBeenCalledWith('End Mobile phone +919847099999?')
  await waitFor(() => expect(within(panel).queryByTestId('identifier-group-phone')).toBeNull())
})

test('9: the ⋯ menu closes on Escape and on a click outside', async ({ admin, createUser }) => {
  const me = await viewer(admin, createUser, 'polish.menu@example.com')
  await admin.post('/api/set_password', { user: me.user, password: 'polish-pw-2' })
  await renderApp('/featherbase/account/sign-in-methods', me)
  const password = await screen.findByTestId('method-password')
  const toggle = within(password).getByRole('button', { name: 'More actions for Password' })
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  await userEvent.click(toggle)
  await userEvent.click(screen.getByRole('heading', { level: 1 }))
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

test('10: "Add" sits in the Identifiers card header and opens a one-line form; Cancel closes it', async ({ admin, createUser }) => {
  const me = await viewer(admin, createUser, 'polish.add@example.com')
  await renderApp('/featherbase/account/sign-in-methods', me)
  const panel = await screen.findByTestId('person-identifiers')
  const heading = within(panel).getByRole('heading', { name: 'Identifiers' })
  const add = await within(panel).findByRole('button', { name: 'Add an identifier' })
  expect(add).toHaveTextContent('Add')
  expect(heading.parentElement).toContainElement(add)
  expect(within(panel).queryByTestId('add-identifier-form')).not.toBeInTheDocument()

  await userEvent.click(add)
  const form = within(panel).getByTestId('add-identifier-form')
  const row = within(form).getByTestId('add-identifier-row')
  expect(row).toHaveClass('flex')
  expect(row).toContainElement(within(form).getByLabelText('Identifier'))
  expect(row).toContainElement(within(form).getByLabelText('Value'))
  expect(document.activeElement).toBe(within(form).getByLabelText('Value'))
  await userEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
  expect(within(panel).queryByTestId('add-identifier-form')).not.toBeInTheDocument()
})

test('11: the email identifier does not repeat "the person’s email" under its own label', async ({ admin, createUser }) => {
  const me = await viewer(admin, createUser, 'polish.email@example.com')
  await renderApp('/featherbase/account/sign-in-methods', me)
  const email = await screen.findByTestId('identifier-group-email')
  expect(email).toHaveTextContent('polish.email@example.com')
  expect(email).toHaveTextContent(/since \d{2}-[A-Z][a-z]{2}-\d{4}/)
  expect(email).not.toHaveTextContent('the person’s email')
  expect(email).not.toHaveTextContent('their own email')
})
