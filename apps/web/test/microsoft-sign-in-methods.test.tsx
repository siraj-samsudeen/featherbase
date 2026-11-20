// Sign in with Microsoft on the account and admin pages (microsoft-sign-in):
// the person's Sign-In Methods page offers to link Microsoft and explains
// each link outcome naming the provider; the administrator's person panel
// shows an expected Microsoft sign-in and a linked Microsoft account by its
// address.
import { screen, within } from '@testing-library/react'
import { sql } from 'server/src/db'
import { linkIdentity } from 'server/src/identities'
import { configureGoogle } from 'server/test/identity-fixtures'
import { configureMicrosoft } from 'server/test/microsoft-mock'
import { rowHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]
const anonymous = { user: null, token: null } as never

async function member(admin: Client, createUser: (o: { email: string; roles: string[] }) => Promise<Client>, email: string) {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Store Reader' } })
  return createUser({ email, roles: ['Store Reader'] })
}

const PAGE = '/featherbase/account/sign-in-methods'

async function outcomeText(person: Client, query: string) {
  window.history.replaceState(null, '', `${PAGE}?${query}`)
  const view = await renderApp(`${PAGE}?${query}`, person)
  // The methods have loaded: the text names the method by its own label.
  await screen.findByTestId('link-microsoft')
  const text = (await screen.findByTestId('link-outcome')).textContent
  view.unmount()
  return text
}

test('the Sign-In Methods page offers to link Microsoft until a Microsoft account is linked', async ({ admin, createUser }) => {
  await configureGoogle({ enabled: true, client_id: '', self_link: true })
  await configureMicrosoft({ self_link: true })
  const person = await member(admin, createUser, 'asha.methods@bisquared.example')
  const first = await renderApp(PAGE, person)
  const link = await screen.findByTestId('link-microsoft')
  expect(link).toHaveTextContent('Link a Microsoft account')
  expect(link).toHaveAttribute('href', '/api/oauth/microsoft/link')
  // Beside Google's link, spaced from it.
  expect(screen.getByTestId('link-google')).toBeInTheDocument()
  expect(link.className).toContain('ml-2')
  first.unmount()

  await linkIdentity(person.user!, { method: 'microsoft', subject: '0b7c1f6e-3c1a-4f7e-9a63-2a6a3c1d9e11/5f1e2d3c-4b5a-4968-8776-655443322110', email: 'asha.methods@bisquared.example' }, 'Administrator')
  await renderApp(PAGE, person)
  await screen.findByTestId('link-google')
  expect(screen.queryByTestId('link-microsoft')).not.toBeInTheDocument()
})

test('every link outcome names the provider it was for', async ({ admin, createUser }) => {
  await configureGoogle({ enabled: true, client_id: '', self_link: true })
  await configureMicrosoft({ self_link: true })
  const person = await member(admin, createUser, 'outcomes@bisquared.example')
  const cases: [string, RegExp][] = [
    ['link=linked&via=microsoft', /Your Microsoft account is linked/],
    ['link=linked', /Your Google account is linked/],
    ['link=taken&via=microsoft', /That Microsoft account belongs to another account/],
    ['link=reserved&via=microsoft', /That Microsoft address is reserved/],
    ['link=google_failed', /Google did not confirm the account/],
    ['link=microsoft_failed&via=microsoft', /Microsoft did not confirm the account/],
    ['link=expired&via=microsoft', /expired or was started in another browser/],
    ['link=sign_in_again&via=microsoft', /Sign in again first/],
    ['link=not_allowed&via=microsoft', /Linking Microsoft is not available/],
    ['link=domain_not_allowed&via=microsoft', /That Microsoft account is not on a domain .* Link your work Microsoft account instead/],
    ['link=wrong_session', /started by a different sign-in/],
    ['link=failed', /Linking did not work/],
  ]
  for (const [query, text] of cases) expect(await outcomeText(person, query)).toMatch(text)
})

test('Microsoft sign-in being off reads as Microsoft\'s on the sign-in page', async () => {
  await configureMicrosoft({ client_id: 'b1e2c3d4-0000-4000-8000-00000000c1d0' })
  await renderApp('/featherbase/login?error=microsoft_off&via=microsoft', anonymous)
  expect(await screen.findByTestId('sign-in-refused')).toHaveTextContent("Microsoft sign-in isn't available right now")
})

test('the administrator\'s panel shows an expected Microsoft sign-in, and a linked Microsoft account by its address', async ({ admin, createUser }) => {
  await configureMicrosoft({ self_link: true })
  const guest = await createUser({ email: 'expects.ms@bisquared.example' })
  await sql`update person set expects_microsoft_sign_in = true where row_id = ${guest.user!}`
  const first = await renderApp(rowHref('Person', guest.user!), admin)
  const panel = await screen.findByTestId('user-sign-in-methods')
  const expected = await within(panel).findByTestId('user-method-expected-microsoft')
  expect(expected).toHaveTextContent('Expected as expects.ms@bisquared.example')
  expect(panel).not.toHaveTextContent('No way to sign in yet')
  first.unmount()

  await linkIdentity(guest.user!, { method: 'microsoft', subject: '0b7c1f6e-3c1a-4f7e-9a63-2a6a3c1d9e11/aaaabbbb-cccc-4ddd-8eee-ffff00001111', email: 'expects.ms@bisquared.example' }, 'Administrator')
  const second = await renderApp(rowHref('Person', guest.user!), admin)
  const after = await screen.findByTestId('user-sign-in-methods')
  // Linked: the mark is used up, and the account reads as its address; its
  // ID waits under Details, named as Microsoft's.
  await within(after).findByText(/expects\.ms@bisquared\.example/)
  expect(within(after).getByTestId('identity-details')).toHaveTextContent('Microsoft account ID: 0b7c1f6e-3c1a-4f7e-9a63-2a6a3c1d9e11/aaaabbbb')
  expect(within(after).queryByTestId('user-method-expected-microsoft')).not.toBeInTheDocument()
  second.unmount()

  // Even marked again, a person who already holds a Microsoft sign-in is not
  // shown as expecting one.
  await sql`update person set expects_microsoft_sign_in = true where row_id = ${guest.user!}`
  await configureGoogle({ enabled: true, client_id: '' })
  await renderApp(rowHref('Person', guest.user!), admin)
  const again = await screen.findByTestId('user-sign-in-methods')
  // The methods have loaded (the Google line needs them), so the panel has
  // judged the Microsoft link it holds.
  await within(again).findByTestId('sign-in-line-google')
  expect(within(again).queryByTestId('user-method-expected-microsoft')).not.toBeInTheDocument()
})
