// person-identities (D6): the signed-in person sees their ways in, can remove
// one, and is stopped before removing the last.
import { vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { configureDelegated, linkDelegated } from 'server/test/identity-fixtures'
import { test, expect, renderApp } from './pg-test'

test('lists the password and a linked service; the last one cannot be removed', async ({ admin, createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'tl.methods@example.com' })
  await admin.post('/api/set_password', { user: tl.user, password: 'methods-pw-1' })
  const identity = await linkDelegated(tl.user!, 'tl_methods')

  await renderApp('/featherbase/admin/sign-in-methods', tl)
  const password = await screen.findByTestId('method-password')
  const hr = await screen.findByTestId(`method-${identity}`)
  expect(hr).toHaveTextContent('StyleHR')
  expect(hr).toHaveTextContent('tl_methods')

  await userEvent.click(within(password).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(screen.queryByTestId('method-password')).not.toBeInTheDocument())

  await userEvent.click(within(screen.getByTestId(`method-${identity}`)).getByRole('button', { name: 'Remove' }))
  expect(await screen.findByTestId('method-error')).toHaveTextContent('last way to sign in')
  expect(screen.getByTestId(`method-${identity}`)).toBeInTheDocument()
})

test('says how a Google link went', async ({ createUser }) => {
  const person = await createUser({ email: 'linked.person@example.com' })
  window.history.replaceState(null, '', '/featherbase/admin/sign-in-methods?link=taken')
  await renderApp('/featherbase/admin/sign-in-methods?link=taken', person)
  expect(await screen.findByTestId('link-outcome')).toHaveTextContent('belongs to another account')
})

// Review B-M4: a System Manager manages anyone's sign-in methods from the User form.
test('on a User form a System Manager links a service, invites Google and unlinks', async ({ admin, createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'tl.panel@example.com' })
  await renderApp(`/featherbase/admin/User/${encodeURIComponent(tl.user!)}`, admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const link = await within(panel).findByTestId('link-delegated-form')
  await userEvent.type(within(link).getByLabelText('Employee code'), 'RR-4242')
  await userEvent.type(within(link).getByLabelText('Login ID at the service'), 'tl_panel')
  await userEvent.click(within(link).getByRole('button', { name: 'Link' }))
  await waitFor(() => expect(panel).toHaveTextContent('RR-4242'))

  const invite = within(panel).getByTestId('invite-google-form')
  await userEvent.type(within(invite).getByLabelText('Google address to invite'), 'tl.panel@gmail.com')
  await userEvent.click(within(invite).getByRole('button'))
  await waitFor(() => expect(panel).toHaveTextContent('invited: tl.panel@gmail.com'))

  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const row = within(panel).getByText(/RR-4242/).closest('li') as HTMLElement
  await userEvent.click(within(row).getByRole('button', { name: 'Unlink' }))
  await waitFor(() => expect(panel).not.toHaveTextContent('RR-4242'))
  expect(confirm).toHaveBeenCalled()
  confirm.mockRestore()
})

test('a person without the System Manager role sees no admin panel on a User form', async ({ createUser }) => {
  const plain = await createUser({ email: 'plain.panel@example.com' })
  await renderApp(`/featherbase/admin/User/${encodeURIComponent(plain.user!)}`, plain)
  await screen.findByTestId('session-user')
  expect(screen.queryByTestId('user-sign-in-methods')).not.toBeInTheDocument()
})

test('the account menu leads to sign-in methods', async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('session-user'))
  expect(await screen.findByTestId('account-sign-in-methods')).toHaveAttribute('href', '/featherbase/admin/sign-in-methods')
})
