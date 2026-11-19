// #1328 (audit F09): the page an address the server cannot open as an app lands on.
// The shared ProblemPage under the top bar; the address repeated as text only; "turned
// off" only for someone who could use the app; one way forward. Made-up people.
import { screen, waitFor, within } from '@testing-library/react'
import { resolve } from 'node:path'
import { discoverPackages } from 'server/src/runtime-packages'
import { test, expect, renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]
const T = { timeout: 8000 }
const BAR_PROOF = resolve(__dirname, '../../../test-apps/fixtures/bar-proof')

async function offBarProof(admin: Client) {
  expect(await discoverPackages([BAR_PROOF])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  await admin.post('/api/set_app_enabled', { name: 'barproof', enabled: false })
}

const shown = async () => {
  const page = await screen.findByTestId('problem-not-found', {}, T)
  return { page, heading: within(page).getByRole('heading').textContent, link: within(page).getByRole('link') }
}

test('an address that is no app says nothing is available there, under the top bar, with the way to Featherbase', async ({ admin }) => {
  await renderApp('/featherbase/unavailable?address=%2Fequipment%2F', admin)
  const { page, heading, link } = await shown()
  expect(heading).toBe('Nothing is available at /equipment/')
  expect(page).toHaveTextContent('Check the address for a typo.')
  expect(link).toHaveTextContent('Go to Featherbase')
  expect(link).toHaveAttribute('href', '/')
  expect(await screen.findByTestId('top-bar', {}, T)).toBeInTheDocument()
  // The address is words, never a link of its own.
  expect(within(page).getAllByRole('link')).toHaveLength(1)
})

test('an app that is turned off says so to someone who could use it, and nothing to anyone else', async ({ admin, createUser }) => {
  await offBarProof(admin)
  await renderApp('/featherbase/unavailable?address=%2Fbarproof%2F', admin)
  expect((await shown()).heading).toBe('Bar proof is turned off')
  expect(screen.getByTestId('problem-not-found')).toHaveTextContent('Ask your system manager to turn it on again.')
  const stranger = await createUser({ email: 'up-stranger@example.test', roles: [] })
  await renderApp('/featherbase/unavailable?address=%2Fbarproof%2F', stranger)
  await waitFor(async () => expect((await shown()).heading).toBe('Nothing is available at /barproof/'), T)
})

test('a person whose place is not the Admin is offered their apps', async ({ createUser }) => {
  const person = await createUser({ email: 'up-app-person@example.test', roles: [] })
  await renderApp('/featherbase/unavailable?address=%2Fequipment%2F', person)
  await waitFor(async () => expect((await shown()).link).toHaveTextContent('Open your apps'), T)
})

test.for([
  ['//evil.example/'],
  ['https://evil.example/'],
  [`/${'x'.repeat(201)}`],
])('an address that is not a plain path (%s) reads as the address you asked for', async ([address], { admin }) => {
  await renderApp(`/featherbase/unavailable?address=${encodeURIComponent(address!)}`, admin)
  expect((await shown()).heading).toBe('Nothing is available at the address you asked for')
})

test('signed out, the page says nothing is there, with no top bar, and names itself in the tab', async ({ anonymous }) => {
  await renderApp('/featherbase/unavailable?address=%2Fbarproof%2F', anonymous)
  expect((await shown()).heading).toBe('Nothing is available at /barproof/')
  expect(screen.queryByTestId('top-bar')).not.toBeInTheDocument()
  await waitFor(() => expect(document.title).toBe('Not Available · Featherbase'))
})
