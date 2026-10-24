// person-identities (D6): the signed-in person sees their ways in, can remove
// one, and is stopped before removing the last.
import { vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { configureDelegated, linkDelegated } from 'server/test/identity-fixtures'
import { VIEWER_ROLE } from 'server/src/sales-target'
import { test, expect, renderApp } from './pg-test'

// A Team Leader holds the Sales Target Viewer role (#410): their Admin is the
// bare shell, and sign-in methods is the one page in it.
async function viewerRole(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: VIEWER_ROLE } })
  return [VIEWER_ROLE]
}

test('lists the password and a linked service; the last one cannot be removed', async ({ admin, createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'tl.methods@example.com', roles: await viewerRole(admin) })
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

test('says how a Google link went', async ({ admin, createUser }) => {
  const person = await createUser({ email: 'linked.person@example.com', roles: await viewerRole(admin) })
  window.history.replaceState(null, '', '/featherbase/admin/sign-in-methods?link=taken')
  await renderApp('/featherbase/admin/sign-in-methods?link=taken', person)
  expect(await screen.findByTestId('link-outcome')).toHaveTextContent('belongs to another account')
})

// Review B-M4: a System Manager manages anyone's sign-in methods from the Person form.
test('on a Person form a System Manager links a service, invites Google and unlinks', async ({ admin, createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'tl.panel@example.com' })
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(tl.user!)}`, admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const link = await within(panel).findByTestId('link-delegated-form')
  await userEvent.type(within(link).getByLabelText('Record number at the service'), 'RR-4242')
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
  // person-resolution D5: the link ends and stays on record as history.
  await waitFor(() => expect(panel).toHaveTextContent(/RR-4242.*ended.*\(unlinked\)/))
  expect(confirm).toHaveBeenCalled()
  confirm.mockRestore()
})

test('a person without the System Manager role sees no admin panel on a Person form', async ({ admin, createUser }) => {
  // Holds a read grant on Person, so the Admin opens for them (#410) - without the System Manager role.
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Person Reader' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: 'Person Reader', can_read: true } })
  const plain = await createUser({ email: 'plain.panel@example.com', roles: ['Person Reader'] })
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(plain.user!)}`, plain)
  await screen.findByTestId('session-user')
  expect(screen.queryByTestId('user-sign-in-methods')).not.toBeInTheDocument()
})

test('the account menu leads to sign-in methods', async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('session-user'))
  expect(await screen.findByTestId('account-sign-in-methods')).toHaveAttribute('href', '/featherbase/admin/sign-in-methods')
})

// Third review round: a refused link keeps what was typed; a link on a
// turned-off method is still named.
test('a refused link keeps the form; a link on a turned-off method is labelled', async ({ admin, createUser }) => {
  await configureDelegated()
  const taken = await createUser({ email: 'tl.taken@example.com' })
  await linkDelegated(taken.user!, 'tl_taken', { subject: 'RR-5000' })
  const tl = await createUser({ email: 'tl.form@example.com' })
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(tl.user!)}`, admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const link = await within(panel).findByTestId('link-delegated-form')
  await userEvent.type(within(link).getByLabelText('Record number at the service'), 'RR-5000')
  await userEvent.click(within(link).getByRole('button', { name: 'Link' }))
  expect(await within(panel).findByTestId('user-method-error')).toHaveTextContent('already linked')
  expect(within(link).getByLabelText('Record number at the service')).toHaveValue('RR-5000')

})

test('a link on a turned-off method is still named on the Person form', async ({ admin, createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'tl.off@example.com' })
  await linkDelegated(tl.user!, 'tl_off')
  const { sql } = await import('server/src/db')
  await sql`update sign_in_method set enabled = false where row_id = 'stylehr'`
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(tl.user!)}`, admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  await waitFor(() => expect(panel).toHaveTextContent('StyleHR (turned off)'))
})
