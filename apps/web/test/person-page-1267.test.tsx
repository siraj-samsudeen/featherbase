// #1267 step 2: a Person's page in two columns. Left: the details, then
// Sign-In (one line per way in, one button each, a small dialog per method),
// then Identifiers. Right: the linked records that have rows, with the empty
// ones a click away, and a glance at the newest activity.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { configureDelegated, linkDelegated } from 'server/test/identity-fixtures'
import { configureMicrosoft } from 'server/test/microsoft-mock'
import { rowHref, tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { PLANT, SITE, seedSites } from './relational-fixture'
import { openLine, showEnded } from './sign-in-lines'

configure({ asyncUtilTimeout: 10_000 })

test('the details lead the left column with Sign-In and Identifiers under them; linked records and activity sit on the right', async ({ admin, createUser }) => {
  const nadia = await createUser({ email: 'nadia.1267@example.com', fullName: 'Nadia Columns' })
  await renderApp(rowHref('Person', nadia.user!), admin)
  const left = await screen.findByTestId('person-left-column')
  expect(within(left).getByTestId('user-sign-in-methods')).toBeInTheDocument()
  expect(within(left).getByTestId('person-identifiers')).toBeInTheDocument()
  const right = screen.getByTestId('person-right-column')
  expect(await within(right).findByTestId('connections-list')).toHaveTextContent('Linked Records')
  expect(within(right).getByTestId('activity-glance')).toBeInTheDocument()
  // Sign-In is the one place for the "expects … sign-in" switches.
  const fields = screen.getByTestId('form-fields')
  expect(fields).not.toHaveTextContent('Expects Google sign-in')
  expect(fields).not.toHaveTextContent('Expects Microsoft sign-in')
  // The chips above the form are gone from a Person's page.
  expect(screen.queryByRole('region', { name: 'Connections' })).not.toBeInTheDocument()
})

test('the activity glance shows the three newest events, newest first, and leads to the Activity tab', async ({ admin, createUser }) => {
  const omar = await createUser({ email: 'omar.1267@example.com', fullName: 'Omar One' })
  for (const name of ['Omar Two', 'Omar Three', 'Omar Four', 'Omar Five']) {
    const row = await admin.get<{ updated_at: string }>(`/api/table/Person/${omar.user}`)
    await admin.post('/api/save_row', { table: 'Person', row: { row_id: omar.user, updated_at: row.updated_at, full_name: name } })
  }
  await renderApp(rowHref('Person', omar.user!), admin)
  const glance = await screen.findByTestId('activity-glance')
  await waitFor(() => expect(within(glance).getAllByTestId('activity-version')).toHaveLength(3))
  const events = within(glance).getAllByTestId('activity-version')
  expect(events[0]).toHaveTextContent('Omar Four → Omar Five')
  expect(events[2]).toHaveTextContent('Omar Two → Omar Three')
  expect(glance).not.toHaveTextContent('Omar One → Omar Two')
  fireEvent.click(screen.getByTestId('see-all-activity'))
  expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true')
})

test("a line's dialog focuses its first field, and Escape closes it back to the line's button", async ({ admin, createUser }) => {
  await configureDelegated()
  const pia = await createUser({ email: 'pia.1267@example.com' })
  await renderApp(rowHref('Person', pia.user!), admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const line = await within(panel).findByTestId('sign-in-line-stylehr')
  expect(line).toHaveTextContent('StyleHR')
  expect(line).toHaveTextContent('Not linked')
  // One button per line.
  expect(within(line).getAllByRole('button')).toHaveLength(1)
  const button = within(line).getByRole('button', { name: 'Link' })
  const dialog = await openLine(panel, 'sign-in-line-stylehr')
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  // Only this method's fields.
  expect(within(dialog).getByLabelText('Record number at the service')).toHaveFocus()
  expect(within(dialog).queryByLabelText('Google address to invite')).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByTestId('sign-in-dialog')).not.toBeInTheDocument()
  expect(button).toHaveFocus()

  // Typing or pressing inside keeps it open; a press on the dimmed page around it closes it.
  const again = await openLine(panel, 'sign-in-line-stylehr')
  await userEvent.keyboard('a')
  fireEvent.mouseDown(again)
  expect(screen.getByTestId('sign-in-dialog')).toBeInTheDocument()
  fireEvent.mouseDown(again.parentElement!)
  expect(screen.queryByTestId('sign-in-dialog')).not.toBeInTheDocument()
  expect(button).toHaveFocus()
})

test('Microsoft is set up and turned off from its line, which sets whether the person is expected to use it', async ({ admin, createUser }) => {
  await configureMicrosoft({ self_link: true })
  const ravi = await createUser({ email: 'ravi.1267@bisquared.example' })
  await renderApp(rowHref('Person', ravi.user!), admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  expect(await within(panel).findByTestId('sign-in-line-microsoft')).toHaveTextContent('Not set up')
  const setUp = await openLine(panel, 'sign-in-line-microsoft')
  expect(setUp).toHaveTextContent('Lets ravi.1267@bisquared.example sign in with Microsoft')
  await userEvent.click(within(setUp).getByRole('button', { name: 'Set Up' }))
  const expected = await within(panel).findByTestId('user-method-expected-microsoft')
  expect(expected).toHaveTextContent('Expected as ravi.1267@bisquared.example')
  expect((await sql`select expects_microsoft_sign_in from person where row_id = ${ravi.user!}`)[0].expects_microsoft_sign_in).toBe(true)

  const off = await openLine(panel, 'user-method-expected-microsoft')
  await userEvent.click(within(off).getByRole('button', { name: 'Turn Off' }))
  expect(await within(panel).findByTestId('sign-in-line-microsoft')).toHaveTextContent('Not set up')
  expect((await sql`select expects_microsoft_sign_in from person where row_id = ${ravi.user!}`)[0].expects_microsoft_sign_in).toBe(false)
})

test("a StyleHR link's Change dialog renames its login ID; ended links wait behind Show N ended", async ({ admin, createUser }) => {
  await configureDelegated()
  const sara = await createUser({ email: 'sara.1267@example.com' })
  const linked = await linkDelegated(sara.user!, 'sara_old', { subject: 'RR-1267' })
  await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by, ended_at, ended_reason)
    values ('uid_ended1267', ${sara.user!}, 'stylehr', 'RR-0001', 'sara_before', 'Administrator', now(), 'unlinked')`
  await renderApp(rowHref('Person', sara.user!), admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const line = await within(panel).findByTestId(`user-method-${linked}`)
  expect(line).toHaveTextContent('Linked · RR-1267 · sara_old')
  expect(within(panel).queryByTestId('user-method-ended-uid_ended1267')).not.toBeInTheDocument()
  await showEnded(panel)
  expect(within(panel).getByTestId('user-method-ended-uid_ended1267')).toHaveTextContent('RR-0001')

  const change = await openLine(panel, `user-method-${linked}`)
  const login = within(change).getByLabelText('Login ID at the service')
  expect(login).toHaveValue('sara_old')
  expect(login).toHaveFocus()
  await userEvent.clear(login)
  await userEvent.type(login, 'sara_new')
  await userEvent.click(within(change).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(within(panel).getByTestId(`user-method-${linked}`)).toHaveTextContent('Linked · RR-1267 · sara_new'))
})

test("hovering the save state on load names the row's last change and who made it, as a link", async ({ admin, createUser }) => {
  const tom = await createUser({ email: 'tom.1267@example.com', fullName: 'Tom Hover' })
  await sql`update person set updated_at = '2026-11-17T08:32:00Z', updated_by = 'Administrator' where row_id = ${tom.user!}`
  await renderApp(rowHref('Person', tom.user!), admin)
  const state = await screen.findByTestId('save-state')
  await userEvent.hover(state)
  const detail = await screen.findByTestId('save-state-detail')
  expect(detail).toHaveTextContent('Last changed 17-Nov-2026 14:02 by Administrator')
  expect(within(detail).getByRole('link', { name: 'Administrator' })).toBeInTheDocument()
  await userEvent.unhover(state)
  await waitFor(() => expect(screen.queryByTestId('save-state-detail')).not.toBeInTheDocument())
  // Keyboard reaches it too.
  state.focus()
  expect(await screen.findByTestId('save-state-detail')).toHaveTextContent('Last changed')
  state.blur()
  await waitFor(() => expect(screen.queryByTestId('save-state-detail')).not.toBeInTheDocument())

  // After a save on this page, it names that save's time.
  const name = screen.getByLabelText('Full Name')
  await userEvent.clear(name)
  await userEvent.type(name, 'Tom Saved')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByTestId('form-banner')).toHaveTextContent('Saved')
  await userEvent.hover(screen.getByTestId('save-state'))
  expect(await screen.findByTestId('save-state-detail')).toHaveTextContent(/^Saved \d{2}:\d{2}$/)
})

test('a record page keeps its empty linked groups behind Show N empty, opened in place', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(`${tableHref(SITE)}/row/MDU`, admin)
  const chips = await screen.findByRole('region', { name: 'Connections' })
  const toggle = await within(chips).findByTestId('connections-show-empty')
  expect(toggle).toHaveTextContent('Show 1 empty')
  expect(within(chips).queryByRole('button', { name: `${PLANT} 0` })).not.toBeInTheDocument()
  fireEvent.click(toggle)
  expect(within(chips).getByRole('button', { name: `${PLANT} 0` })).toBeInTheDocument()
  expect(toggle).toHaveTextContent('Hide empty')
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
})

test('a linked Google account is turned off from its line, and the link moves under Show N ended', async ({ admin, createUser }) => {
  const { inviteGoogleRaw } = await import('server/test/identity-fixtures')
  const gita = await createUser({ email: 'gita.1267@example.com' })
  const linked = await inviteGoogleRaw(gita.user!, 'gita.1267@gmail.com')
  await sql`update sign_in_identity set subject = 'g-1267', email = 'gita.1267@gmail.com', pending_email = null,
    linked_by = 'Administrator', linked_at = now() where id = ${linked}`
  await renderApp(rowHref('Person', gita.user!), admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const off = await openLine(panel, `user-method-${linked}`)
  // A confirmation with nothing to type focuses its one action.
  expect(within(off).getByRole('button', { name: 'Turn Off' })).toHaveFocus()
  await userEvent.click(within(off).getByRole('button', { name: 'Turn Off' }))
  expect(await within(panel).findByTestId('sign-in-line-google')).toHaveTextContent('Not set up')
  await showEnded(panel)
  expect(within(panel).getByTestId(`user-method-ended-${linked}`)).toHaveTextContent('gita.1267@gmail.com')
})

test('a pending Google invite is withdrawn from its Change dialog', async ({ admin, createUser }) => {
  const hari = await createUser({ email: 'hari.1267@example.com' })
  const { id } = await admin.post<{ id: string }>(`/api/people/${encodeURIComponent(hari.user!)}/identities`, {
    method: 'google', email: 'hari.1267@gmail.com', send_invitation_email: false,
  })
  await renderApp(rowHref('Person', hari.user!), admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  expect(await within(panel).findByTestId(`user-method-${id}`)).toHaveTextContent('Invited · hari.1267@gmail.com')
  const change = await openLine(panel, `user-method-${id}`)
  expect(within(change).getByRole('button', { name: 'Resend Invitation' })).toHaveFocus()
  await userEvent.click(within(change).getByRole('button', { name: 'Withdraw Invite' }))
  expect(await within(panel).findByTestId('sign-in-line-google')).toHaveTextContent('Not set up')
})

test('an expected Google sign-in is stopped from its Change dialog', async ({ admin, createUser }) => {
  const ila = await createUser({ email: 'ila.1267@gmail.com' })
  await sql`update person set expects_google_sign_in = true where row_id = ${ila.user!}`
  await renderApp(rowHref('Person', ila.user!), admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const change = await openLine(panel, 'user-method-expected-google')
  await userEvent.click(within(change).getByRole('button', { name: 'Stop Expecting' }))
  expect(await within(panel).findByTestId('sign-in-line-google')).toHaveTextContent('Not set up')
  expect((await sql`select expects_google_sign_in from person where row_id = ${ila.user!}`)[0].expects_google_sign_in).toBe(false)
})

test('Escape closes the save state card', async ({ admin, createUser }) => {
  const jo = await createUser({ email: 'jo.1267@example.com' })
  await renderApp(rowHref('Person', jo.user!), admin)
  const state = await screen.findByTestId('save-state')
  state.focus()
  await screen.findByTestId('save-state-detail')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByTestId('save-state-detail')).not.toBeInTheDocument()
})

test("a Person's linked records list each group's rows by name, and a row opens in the pane", async ({ admin, createUser }) => {
  const kim = await createUser({ email: 'kim.1267@example.com', fullName: 'Kim Old' })
  const lee = await createUser({ email: 'lee.1267@example.com', fullName: 'Lee New' })
  await sql`update person set replaced_by = ${lee.user!}, enabled = false where row_id = ${kim.user!}`
  await renderApp(rowHref('Person', lee.user!), admin)
  const list = await screen.findByTestId('connections-list')
  // #1218 slice 1: the group with rows shows them, each named as a link (LinkedRowsGroup).
  const group = await within(list).findByTestId('linked-rows-group')
  expect(within(group).getByRole('heading')).toHaveTextContent(/1$/)
  fireEvent.click(await within(group).findByRole('link', { name: 'Kim Old' }))
  expect(await screen.findByRole('complementary', { name: /Kim Old/ })).toBeInTheDocument()
})

test("a Person's own links lead its linked records, with empty groups a click away", async ({ admin, createUser }) => {
  const kim = await createUser({ email: 'kim2.1267@example.com', fullName: 'Kim Old' })
  const lee = await createUser({ email: 'lee2.1267@example.com', fullName: 'Lee New' })
  await sql`update person set replaced_by = ${lee.user!}, enabled = false where row_id = ${kim.user!}`
  await renderApp(rowHref('Person', kim.user!), admin)
  const kims = await screen.findByTestId('connections-list')
  // Its own link (Replaced by) leads the list.
  expect(await within(kims).findByText('Replaced by')).toBeInTheDocument()
  const toggle = await within(kims).findByTestId('connections-show-empty')
  expect(within(kims).getByText('Nothing links here yet.')).toBeInTheDocument()
  expect(within(kims).queryAllByTestId('linked-rows-group')).toHaveLength(0)
  fireEvent.click(toggle)
  expect(within(kims).getAllByTestId('linked-rows-group').length).toBeGreaterThan(0)
  expect(within(kims).queryByText('Nothing links here yet.')).not.toBeInTheDocument()
})

test("Google's Set Up dialog can expect the person's own address instead of inviting it", async ({ admin, createUser }) => {
  const uma = await createUser({ email: 'uma.1267@gmail.com' })
  await renderApp(rowHref('Person', uma.user!), admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const setUp = await openLine(panel, 'sign-in-line-google')
  expect(setUp).toHaveTextContent('Expecting uma.1267@gmail.com instead lets it in only when its domain is allowed')
  await userEvent.click(within(setUp).getByRole('button', { name: 'Expect Sign-In Instead' }))
  expect(await within(panel).findByTestId('user-method-expected-google')).toHaveTextContent('Expected as uma.1267@gmail.com')
  expect((await sql`select expects_google_sign_in from person where row_id = ${uma.user!}`)[0].expects_google_sign_in).toBe(true)
})

test('after a link redraws its line, focus goes to the Sign-In heading, not the page', async ({ admin, createUser }) => {
  await configureDelegated()
  const val = await createUser({ email: 'val.1267@example.com' })
  await renderApp(rowHref('Person', val.user!), admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const link = await openLine(panel, 'sign-in-line-stylehr')
  await userEvent.type(within(link).getByLabelText('Record number at the service'), 'RR-7777')
  await userEvent.click(within(link).getByRole('button', { name: 'Link' }))
  await waitFor(() => expect(screen.queryByTestId('sign-in-dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(within(panel).getByRole('heading', { name: 'Sign-In' })).toHaveFocus())
})

test('Identifiers wait, closed, under Identifier History; opening it shows their periods', async ({ admin, createUser }) => {
  const xan = await createUser({ email: 'xan.1267@example.com' })
  await renderApp(rowHref('Person', xan.user!), admin)
  const history = await screen.findByTestId('person-identifiers')
  expect(history.tagName).toBe('DETAILS')
  expect(history).not.toHaveAttribute('open')
  expect(within(history).getByTestId('identifier-history-toggle')).toHaveTextContent('Identifier History')
  await userEvent.click(within(history).getByTestId('identifier-history-toggle'))
  expect(history).toHaveAttribute('open')
  await waitFor(() => expect(history).toHaveTextContent(/xan\.1267@example\.com.*since/))
})

test("the record pane leaves out a Person's sign-in switches", async ({ admin, createUser }) => {
  const kim = await createUser({ email: 'kim3.1267@example.com', fullName: 'Kim Pane' })
  const lee = await createUser({ email: 'lee3.1267@example.com', fullName: 'Lee Pane' })
  await sql`update person set replaced_by = ${lee.user!}, enabled = false where row_id = ${kim.user!}`
  await renderApp(rowHref('Person', lee.user!), admin)
  const list = await screen.findByTestId('connections-list')
  fireEvent.click(await within(list).findByRole('link', { name: 'Kim Pane' }))
  const pane = await screen.findByRole('complementary', { name: /Kim Pane/ })
  await waitFor(() => expect(pane).toHaveTextContent('Full Name'))
  expect(pane).not.toHaveTextContent('Expects Google sign-in')
  expect(pane).not.toHaveTextContent('Expects Microsoft sign-in')
})
