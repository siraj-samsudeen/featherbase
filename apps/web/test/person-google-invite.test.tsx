// #833: letting an outside Google account in takes the address once, and the
// panel never says an invitation was emailed when it went to the Email Sink.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { _setInvitationDeliveryForTests } from 'server/src/invitation-email'
import { test, expect, renderApp } from './pg-test'
import { rowHref } from 'shared'
import { openLine } from './sign-in-lines'

type Admin = Parameters<typeof renderApp>[1]

async function openPerson(admin: Admin, user: string) {
  await renderApp(rowHref('Person', user), admin)
  return screen.findByTestId('user-sign-in-methods')
}

test('#833: the invite starts from the Person\'s own address, so it is typed once', async ({ admin, createUser }) => {
  const guest = await createUser({ email: 'once.guest@gmail.com' })
  const panel = await openPerson(admin, guest.user!)
  const invite = within(await openLine(panel, 'sign-in-line-google')).getByTestId('invite-google-form')
  await waitFor(() => expect(within(invite).getByLabelText('Google address to invite')).toHaveValue('once.guest@gmail.com'))
  await userEvent.click(within(invite).getByRole('button', { name: 'Invite' }))
  await waitFor(() => expect(panel).toHaveTextContent('Invited · once.guest@gmail.com'))
})

test('#833: a Person who expects Google sign-in is not shown as having no way in, and is told what lets them in', async ({ admin, createUser }) => {
  const guest = await createUser({ email: 'expects.guest@gmail.com' })
  await sql`update person set expects_google_sign_in = true where row_id = ${guest.user!}`
  const panel = await openPerson(admin, guest.user!)
  const expected = await within(panel).findByTestId('user-method-expected-google')
  expect(expected).toHaveTextContent('Expected as expects.guest@gmail.com, when its domain is allowed')
  expect(panel).not.toHaveTextContent('No way to sign in yet')
  // #1267: the line's Change dialog says what an invite adds.
  const dialog = await openLine(panel, 'user-method-expected-google')
  expect(dialog).toHaveTextContent('lets it in only when its domain is allowed')
  expect(dialog).toHaveTextContent('An invite lets it in from any domain')
})

test('#833: with no SMTP server, the panel says the invitation went to the Email Sink, not that it was emailed', async ({ admin, createUser }) => {
  const guest = await createUser({ email: 'sink.guest@gmail.com' })
  const panel = await openPerson(admin, guest.user!)
  const invite = within(await openLine(panel, 'sign-in-line-google')).getByTestId('invite-google-form')
  await waitFor(() => expect(within(invite).getByLabelText('Google address to invite')).toHaveValue('sink.guest@gmail.com'))
  await userEvent.click(within(invite).getByRole('button', { name: 'Invite' }))
  const notice = await within(panel).findByTestId('user-method-notice')
  expect(notice).toHaveTextContent('Invitation saved to the Email Sink for sink.guest@gmail.com; this instance does not send email.')
  expect(within(notice).getByRole('link', { name: 'Email Sink' })).toHaveAttribute('href', '/featherbase/admin/table/email-sink')
  await waitFor(() => expect(panel).toHaveTextContent('invitation saved to the Email Sink'))
  expect(panel).not.toHaveTextContent(/emailed/i)
})

test('#833: with an SMTP server, the panel says the invitation was emailed', async ({ admin, createUser }) => {
  const saved = process.env.SMTP_HOST
  process.env.SMTP_HOST = 'smtp.example.test'
  _setInvitationDeliveryForTests(async () => {})
  try {
    const guest = await createUser({ email: 'smtp.guest@gmail.com' })
    const panel = await openPerson(admin, guest.user!)
    const invite = within(await openLine(panel, 'sign-in-line-google')).getByTestId('invite-google-form')
    await waitFor(() => expect(within(invite).getByLabelText('Google address to invite')).toHaveValue('smtp.guest@gmail.com'))
    await userEvent.click(within(invite).getByRole('button', { name: 'Invite' }))
    expect(await within(panel).findByTestId('user-method-notice')).toHaveTextContent('Invitation emailed to smtp.guest@gmail.com.')
    await waitFor(() => expect(panel).toHaveTextContent('invitation emailed'))
  } finally {
    _setInvitationDeliveryForTests(null)
    if (saved === undefined) delete process.env.SMTP_HOST
    else process.env.SMTP_HOST = saved
  }
})
