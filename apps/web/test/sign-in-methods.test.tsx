// person-identities (D6): the signed-in person sees their ways in, can remove
// one, and is stopped before removing the last.
import { vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { configureDelegated, inviteGoogleRaw, linkDelegated } from 'server/test/identity-fixtures'
import { VIEWER_ROLE } from 'server/src/sales-target'
import { test, expect, renderApp } from './pg-test'
import { rowHref } from 'shared'
import { grantRole } from 'server/test/fixtures'

// A Team Leader holds the Sales Target Viewer role (#410): their sign-in
// methods are an account page outside the Admin screens (#489).
async function viewerRole(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: VIEWER_ROLE } })
  return [VIEWER_ROLE]
}

test('lists the password and a linked service; the last one cannot be removed', async ({ admin, createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'tl.methods@example.com', roles: await viewerRole(admin) })
  await admin.post('/api/set_password', { user: tl.user, password: 'methods-pw-1' })
  const identity = await linkDelegated(tl.user!, 'tl_methods')

  await renderApp('/featherbase/account/sign-in-methods', tl)
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
  window.history.replaceState(null, '', '/featherbase/account/sign-in-methods?link=taken')
  await renderApp('/featherbase/account/sign-in-methods?link=taken', person)
  expect(await screen.findByTestId('link-outcome')).toHaveTextContent('belongs to another account')
})

// Review B-M4: a System Manager manages anyone's sign-in methods from the Person form.
test('on a Person form a System Manager links a service, invites Google and unlinks', async ({ admin, createUser }) => {
  await configureDelegated()
  const tl = await createUser({ email: 'tl.panel@example.com' })
  await renderApp(`/featherbase/admin/table/person/row/${encodeURIComponent(tl.user!)}`, admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const link = await within(panel).findByTestId('link-delegated-form')
  await userEvent.type(within(link).getByLabelText('Record number at the service'), 'RR-4242')
  await userEvent.type(within(link).getByLabelText('Login ID at the service'), 'tl_panel')
  await userEvent.click(within(link).getByRole('button', { name: 'Link' }))
  await waitFor(() => expect(panel).toHaveTextContent('RR-4242'))

  const invite = within(panel).getByTestId('invite-google-form')
  await userEvent.clear(within(invite).getByLabelText('Google address to invite'))
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
  await grantRole(admin, { table: 'Person', role: 'Person Reader', can_read: true })
  const plain = await createUser({ email: 'plain.panel@example.com', roles: ['Person Reader'] })
  await renderApp(`/featherbase/admin/table/person/row/${encodeURIComponent(plain.user!)}`, plain)
  await screen.findByTestId('session-user')
  expect(screen.queryByTestId('user-sign-in-methods')).not.toBeInTheDocument()
})

test('the account menu leads to sign-in methods', async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('session-user'))
  expect(await screen.findByTestId('account-sign-in-methods')).toHaveAttribute('href', '/featherbase/account/sign-in-methods')
})

// Third review round: a refused link keeps what was typed; a link on a
// turned-off method is still named.
test('a refused link keeps the form; a link on a turned-off method is labelled', async ({ admin, createUser }) => {
  await configureDelegated()
  const taken = await createUser({ email: 'tl.taken@example.com' })
  await linkDelegated(taken.user!, 'tl_taken', { subject: 'RR-5000' })
  const tl = await createUser({ email: 'tl.form@example.com' })
  await renderApp(`/featherbase/admin/table/person/row/${encodeURIComponent(tl.user!)}`, admin)
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
  await renderApp(`/featherbase/admin/table/person/row/${encodeURIComponent(tl.user!)}`, admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  await waitFor(() => expect(panel).toHaveTextContent('StyleHR (turned off)'))
})

// #430: inviting emails the address by default; the inviter can skip it, sees
// a failed send, and can resend a pending invite (not twice in ten minutes).
test('inviting emails the address unless the box is cleared', async ({ admin, createUser }) => {
  const { sql } = await import('server/src/db')
  const tl = await createUser({ email: 'tl.mail@example.com' })
  await renderApp(`/featherbase/admin/table/person/row/${encodeURIComponent(tl.user!)}`, admin)
  // The panel re-renders after each invite, so the form is found afresh.
  const panel = () => screen.getByTestId('user-sign-in-methods')
  const form = () => within(panel()).getByTestId('invite-google-form')
  await screen.findByTestId('invite-google-form')
  let invite = form()
  expect(within(invite).getByLabelText('Email an invitation to this address')).toBeChecked()
  // #833: the field starts with the Person's own address; this invite is another.
  await userEvent.clear(within(invite).getByLabelText('Google address to invite'))
  await userEvent.type(within(invite).getByLabelText('Google address to invite'), 'tl.mail@gmail.com')
  await userEvent.click(within(invite).getByRole('button'))
  expect(await within(panel()).findByTestId('user-method-notice')).toHaveTextContent('Invitation saved to the Email Sink for tl.mail@gmail.com')
  expect(await sql`select 1 from email_sink where mail_to = 'tl.mail@gmail.com'`).toHaveLength(1)

  await waitFor(() => expect(panel()).toHaveTextContent('invited: tl.mail@gmail.com'))
  invite = form()
  await userEvent.clear(within(invite).getByLabelText('Google address to invite'))
  await userEvent.type(within(invite).getByLabelText('Google address to invite'), 'tl.quiet@gmail.com')
  await userEvent.click(within(invite).getByLabelText('Email an invitation to this address'))
  await userEvent.click(within(invite).getByRole('button'))
  await waitFor(() => expect(panel()).toHaveTextContent('invited: tl.quiet@gmail.com'))
  expect(await sql`select 1 from email_sink where mail_to = 'tl.quiet@gmail.com'`).toHaveLength(0)
  // The box is ticked again for the next invite.
  expect(within(form()).getByLabelText('Email an invitation to this address')).toBeChecked()
})

test('a failed invitation email is shown, and the invite is still made', async ({ admin, createUser }) => {
  const { _setInvitationDeliveryForTests } = await import('server/src/invitation-email')
  _setInvitationDeliveryForTests(async () => {
    throw Object.assign(new Error('refused'), { code: 'ECONNECTION' })
  })
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const tl = await createUser({ email: 'tl.fail@example.com' })
    await renderApp(`/featherbase/admin/table/person/row/${encodeURIComponent(tl.user!)}`, admin)
    const panel = await screen.findByTestId('user-sign-in-methods')
    const invite = await within(panel).findByTestId('invite-google-form')
    await userEvent.clear(within(invite).getByLabelText('Google address to invite'))
    await userEvent.type(within(invite).getByLabelText('Google address to invite'), 'tl.fail@gmail.com')
    await userEvent.click(within(invite).getByRole('button'))
    expect(await within(panel).findByTestId('user-method-error')).toHaveTextContent(
      'Invited tl.fail@gmail.com, but the invitation email was not sent (ECONNECTION)',
    )
    await waitFor(() => expect(panel).toHaveTextContent('invited: tl.fail@gmail.com'))
  } finally {
    _setInvitationDeliveryForTests(null)
    quiet.mockRestore()
  }
})

test('a pending invite can be resent, but not again within ten minutes', async ({ admin, createUser }) => {
  const { sql } = await import('server/src/db')
  const tl = await createUser({ email: 'tl.resend@example.com' })
  await admin.post(`/api/people/${encodeURIComponent(tl.user!)}/identities`, {
    method: 'google', email: 'tl.resend@gmail.com', send_invitation_email: false,
  })
  await renderApp(`/featherbase/admin/table/person/row/${encodeURIComponent(tl.user!)}`, admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const row = (await within(panel).findByText(/invited: tl.resend@gmail.com/)).closest('li') as HTMLElement
  await userEvent.click(within(row).getByRole('button', { name: 'Resend invitation' }))
  expect(await within(panel).findByTestId('user-method-notice')).toHaveTextContent('Invitation saved to the Email Sink for tl.resend@gmail.com')
  await waitFor(() => expect(row).toHaveTextContent('invitation saved to the Email Sink'))
  await userEvent.click(within(row).getByRole('button', { name: 'Resend invitation' }))
  expect(await within(panel).findByTestId('user-method-error')).toHaveTextContent('10 minutes')
  expect(await sql`select 1 from email_sink where mail_to = 'tl.resend@gmail.com'`).toHaveLength(1)
})

// #837: a claimed Google invite leads with the address, says when and how it
// was linked and last used, and keeps Google's account number under Details.
test('a linked Google account reads as its address, when and how it was linked, and last used', async ({ admin, createUser }) => {
  const { sql } = await import('server/src/db')
  const tl = await createUser({ email: 'tl.google@example.com' })
  const claimed = await inviteGoogleRaw(tl.user!, 'tl.google@gmail.com')
  await sql`update sign_in_identity set subject = '104116711844961612173', email = 'tl.google@gmail.com', pending_email = null,
    linked_by = 'first-sign-in', linked_at = '2026-11-03T06:41:00Z', last_used_at = '2026-11-03T07:05:00Z' where id = ${claimed}`
  await renderApp(rowHref('Person', tl.user!), admin)
  const row = await screen.findByTestId(`user-method-${claimed}`)
  await waitFor(() => expect(within(row).getByTestId('identity-head')).toHaveTextContent(/^Google · tl\.google@gmail\.com$/))
  expect(within(row).getByTestId('identity-linked')).toHaveTextContent(
    'linked 03-Nov-2026 12:11 IST at first sign-in · last signed in 03-Nov-2026 12:35 IST',
  )
  const details = within(row).getByTestId('identity-details')
  expect(details).not.toHaveAttribute('open')
  expect(details).toHaveTextContent('Google account number: 104116711844961612173')

  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await userEvent.click(within(row).getByRole('button', { name: 'Unlink' }))
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/^Unlink tl\.google@gmail\.com\? This Google account will no longer sign in as .+\.$/))
  confirm.mockRestore()
})

test('a link the person made themselves names them', async ({ admin, createUser }) => {
  const { sql } = await import('server/src/db')
  const tl = await createUser({ email: 'tl.self@example.com', fullName: 'Tara Self' })
  const linked = await inviteGoogleRaw(tl.user!, 'tl.self@gmail.com')
  await sql`update sign_in_identity set subject = 'g-self', email = 'tl.self@gmail.com', pending_email = null,
    linked_by = 'self', linked_at = '2026-11-03T06:41:00Z', last_used_at = null where id = ${linked}`
  await renderApp(rowHref('Person', tl.user!), admin)
  const row = await screen.findByTestId(`user-method-${linked}`)
  await waitFor(() => expect(within(row).getByTestId('identity-linked')).toHaveTextContent('linked 03-Nov-2026 12:11 IST by Tara Self'))
})

test('a link an administrator made names them, and an unused one says so', async ({ admin, createUser }) => {
  const { sql } = await import('server/src/db')
  const tl = await createUser({ email: 'tl.byadmin@example.com' })
  const linked = await inviteGoogleRaw(tl.user!, 'tl.byadmin@gmail.com')
  await sql`update sign_in_identity set subject = 'g-byadmin', email = 'tl.byadmin@gmail.com', pending_email = null,
    linked_by = 'Administrator', linked_at = '2026-11-03T06:41:00Z', last_used_at = null where id = ${linked}`
  await renderApp(rowHref('Person', tl.user!), admin)
  const row = await screen.findByTestId(`user-method-${linked}`)
  await waitFor(() =>
    expect(within(row).getByTestId('identity-linked')).toHaveTextContent('linked 03-Nov-2026 12:11 IST by Administrator · not signed in with it yet'),
  )
})
