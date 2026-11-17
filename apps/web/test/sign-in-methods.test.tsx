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
import { openLine, showEnded } from './sign-in-lines'

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

  // #1235 item 9: removing is in a ⋯ menu and asks first.
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await userEvent.click(within(password).getByRole('button', { name: 'More actions for Password' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }))
  await waitFor(() => expect(screen.queryByTestId('method-password')).not.toBeInTheDocument())

  await userEvent.click(within(screen.getByTestId(`method-${identity}`)).getByRole('button', { name: 'More actions for StyleHR' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }))
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
  const link = within(await openLine(panel, 'sign-in-line-stylehr')).getByTestId('link-delegated-form')
  await userEvent.type(within(link).getByLabelText('Record number at the service'), 'RR-4242')
  await userEvent.type(within(link).getByLabelText('Login ID at the service'), 'tl_panel')
  await userEvent.click(within(link).getByRole('button', { name: 'Link' }))
  await waitFor(() => expect(panel).toHaveTextContent('RR-4242'))

  const invite = within(await openLine(panel, 'sign-in-line-google')).getByTestId('invite-google-form')
  await userEvent.clear(within(invite).getByLabelText('Google address to invite'))
  await userEvent.type(within(invite).getByLabelText('Google address to invite'), 'tl.panel@gmail.com')
  await userEvent.click(within(invite).getByRole('button', { name: 'Invite' }))
  await waitFor(() => expect(panel).toHaveTextContent('Invited · tl.panel@gmail.com'))

  // #1267: a StyleHR link's Change dialog holds its Unlink.
  const row = within(panel).getByText(/RR-4242/).closest('[data-testid^="user-method-"]') as HTMLElement
  await userEvent.click(within(row).getByRole('button', { name: 'Change' }))
  await userEvent.click(within(await within(panel).findByTestId('sign-in-dialog')).getByRole('button', { name: 'Unlink' }))
  // person-resolution D5: the link ends and stays on record as history.
  await showEnded(panel)
  await waitFor(() => expect(panel).toHaveTextContent(/RR-4242.*ended.*\(unlinked\)/))
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
  const link = within(await openLine(panel, 'sign-in-line-stylehr')).getByTestId('link-delegated-form')
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
test('inviting with the box cleared sends no email, and the box is ticked again next time', async ({ admin, createUser }) => {
  const { sql } = await import('server/src/db')
  // The box clears for one invite only: closing the dialog and opening it again ticks it.
  const quiet = await createUser({ email: 'tl.quiet@example.com' })
  await renderApp(`/featherbase/admin/table/person/row/${encodeURIComponent(quiet.user!)}`, admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  let invite = within(await openLine(panel, 'sign-in-line-google')).getByTestId('invite-google-form')
  await userEvent.click(within(invite).getByLabelText('Email an invitation to this address'))
  expect(within(invite).getByLabelText('Email an invitation to this address')).not.toBeChecked()
  await userEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
  invite = within(await openLine(panel, 'sign-in-line-google')).getByTestId('invite-google-form')
  expect(within(invite).getByLabelText('Email an invitation to this address')).toBeChecked()
  await userEvent.click(within(invite).getByLabelText('Email an invitation to this address'))
  await userEvent.clear(within(invite).getByLabelText('Google address to invite'))
  await userEvent.type(within(invite).getByLabelText('Google address to invite'), 'tl.quiet@gmail.com')
  await userEvent.click(within(invite).getByRole('button', { name: 'Invite' }))
  await waitFor(() => expect(panel).toHaveTextContent('Invited · tl.quiet@gmail.com'))
  expect(await sql`select 1 from email_sink where mail_to = 'tl.quiet@gmail.com'`).toHaveLength(0)
})

test('inviting with the box ticked emails the address', async ({ admin, createUser }) => {
  const { sql } = await import('server/src/db')
  const tl = await createUser({ email: 'tl.mail@example.com' })
  await renderApp(`/featherbase/admin/table/person/row/${encodeURIComponent(tl.user!)}`, admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const invite = within(await openLine(panel, 'sign-in-line-google')).getByTestId('invite-google-form')
  expect(within(invite).getByLabelText('Email an invitation to this address')).toBeChecked()
  // #833: the field starts with the Person's own address; this invite is another.
  await userEvent.clear(within(invite).getByLabelText('Google address to invite'))
  await userEvent.type(within(invite).getByLabelText('Google address to invite'), 'tl.mail@gmail.com')
  await userEvent.click(within(invite).getByRole('button', { name: 'Invite' }))
  expect(await within(panel).findByTestId('user-method-notice')).toHaveTextContent('Invitation saved to the Email Sink for tl.mail@gmail.com')
  expect(await sql`select 1 from email_sink where mail_to = 'tl.mail@gmail.com'`).toHaveLength(1)
  await waitFor(() => expect(panel).toHaveTextContent('Invited · tl.mail@gmail.com'))
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
    const invite = within(await openLine(panel, 'sign-in-line-google')).getByTestId('invite-google-form')
    await userEvent.clear(within(invite).getByLabelText('Google address to invite'))
    await userEvent.type(within(invite).getByLabelText('Google address to invite'), 'tl.fail@gmail.com')
    await userEvent.click(within(invite).getByRole('button', { name: 'Invite' }))
    expect(await within(panel).findByTestId('user-method-error')).toHaveTextContent(
      'Invited tl.fail@gmail.com, but the invitation email was not sent (ECONNECTION)',
    )
    await waitFor(() => expect(panel).toHaveTextContent('Invited · tl.fail@gmail.com'))
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
  const row = (await within(panel).findByText('tl.resend@gmail.com')).closest('[data-testid^="user-method-"]') as HTMLElement
  await userEvent.click(within(row).getByRole('button', { name: 'Change' }))
  await userEvent.click(within(await within(panel).findByTestId('sign-in-dialog')).getByRole('button', { name: 'Resend Invitation' }))
  expect(await within(panel).findByTestId('user-method-notice')).toHaveTextContent('Invitation saved to the Email Sink for tl.resend@gmail.com')
  await waitFor(() => expect(within(panel).getByTestId(row.dataset.testid!)).toHaveTextContent('invitation saved to the Email Sink'))
  await userEvent.click(within(within(panel).getByTestId(row.dataset.testid!)).getByRole('button', { name: 'Change' }))
  await userEvent.click(within(await within(panel).findByTestId('sign-in-dialog')).getByRole('button', { name: 'Resend Invitation' }))
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
  // #1267: the line names the method; its status reads the account by its address.
  expect(row).toHaveTextContent(/^Google/)
  await waitFor(() => expect(within(row).getByTestId('identity-head')).toHaveTextContent(/^On · signs in as tl\.google@gmail\.com$/))
  expect(within(row).getByTestId('identity-linked')).toHaveTextContent(
    'linked 03-Nov-2026 12:11 IST at first sign-in · last signed in 03-Nov-2026 12:35 IST',
  )
  const details = within(row).getByTestId('identity-details')
  expect(details).not.toHaveAttribute('open')
  expect(details).toHaveTextContent('Google account number: 104116711844961612173')

  await userEvent.click(within(row).getByRole('button', { name: 'Turn Off' }))
  const dialog = await screen.findByTestId('sign-in-dialog')
  expect(dialog).toHaveTextContent(/Unlink tl\.google@gmail\.com\? This Google account will no longer sign in as .+\./)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByTestId('sign-in-dialog')).not.toBeInTheDocument()
  expect(screen.getByTestId(`user-method-${claimed}`)).toBeInTheDocument()
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

// #1266: a password manager filled the manager's own address into someone else's link field.
test("a Person page's link fields give browsers and password managers nothing to fill, and another person's address is refused by name", async ({ admin, createUser }) => {
  await configureDelegated()
  await createUser({ email: 'boss.1266@example.com', fullName: 'Boss Person' } as never)
  const tl = await createUser({ email: 'tl.1266@example.com' })
  await renderApp(`/featherbase/admin/table/person/row/${encodeURIComponent(tl.user!)}`, admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const invite = within(await openLine(panel, 'sign-in-line-google')).getByTestId('invite-google-form').cloneNode(true) as HTMLElement
  await userEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
  const link = within(await openLine(panel, 'sign-in-line-stylehr')).getByTestId('link-delegated-form')
  for (const form of [link, invite]) {
    expect(form).toHaveAttribute('autocomplete', 'off')
    for (const input of form.querySelectorAll('input:not([type=checkbox])')) {
      expect(input).toHaveAttribute('autocomplete', 'off')
      expect(input).toHaveAttribute('data-1p-ignore')
      expect(input).toHaveAttribute('data-lpignore', 'true')
      expect(input.getAttribute('name')).not.toMatch(/^(email|username|user|login)$/)
      expect(input.getAttribute('type')).not.toBe('email')
    }
  }
  await userEvent.type(within(link).getByLabelText('Record number at the service'), 'RR-1266')
  await userEvent.type(within(link).getByLabelText('Login ID at the service'), 'boss.1266@example.com')
  await userEvent.click(within(link).getByRole('button', { name: 'Link' }))
  await waitFor(() => expect(within(panel).getByTestId('user-method-error')).toHaveTextContent('already belongs to'))
  expect(within(panel).getByTestId('user-method-error')).not.toHaveTextContent('psn_')
})
