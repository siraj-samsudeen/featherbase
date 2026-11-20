// #1328 (audit F09): the page an address the server cannot open as an app lands on.
// Signed in, the shared ProblemPage in the white panel of the person's own frame (the sidebar); signed out,
// the page alone. The address repeated as text only; "turned off" only for someone who could use the app;
// one way forward. Made-up people.
import { screen, waitFor, within } from '@testing-library/react'
import { resolve } from 'node:path'
import { discoverPackages } from 'server/src/runtime-packages'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]
const T = { timeout: 8000 }
const anonymous = { user: null, token: null } as never
afterEach(() => vi.restoreAllMocks())
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

test('an address that is no app says nothing is available there, in the frame\'s white panel, with the way to Featherbase', async ({ admin }) => {
  await renderApp('/featherbase/unavailable?address=%2Fequipment%2F', admin)
  const { page, heading, link } = await shown()
  expect(heading).toBe('Nothing Is Available at /equipment/')
  expect(page).toHaveTextContent('Check the address for a typo.')
  expect(link).toHaveTextContent('Go to Featherbase')
  expect(link).toHaveAttribute('href', '/')
  // In the Admin frame: its sidebar beside, the message in the white panel; no frame of the page's own.
  expect(await screen.findByTestId('admin-sidebar', {}, T)).toBeInTheDocument()
  expect(screen.getByTestId('page-panel')).toContainElement(page)
  // The address is words, never a link of its own.
  expect(within(page).getAllByRole('link')).toHaveLength(1)
})

test('an app that is turned off says so to someone who could use it', async ({ admin }) => {
  await offBarProof(admin)
  await renderApp('/featherbase/unavailable?address=%2Fbarproof%2F', admin)
  await waitFor(async () => expect((await shown()).heading).toBe('Bar proof Is Turned Off'), T)
  expect(screen.getByTestId('problem-not-found')).toHaveTextContent('Ask your System Manager to turn it on again.')
})

test('the same turned-off app reads as nothing at all to someone who could not use it', async ({ admin, createUser }) => {
  await offBarProof(admin)
  const stranger = await createUser({ email: 'up-stranger@example.test', roles: [] })
  await renderApp('/featherbase/unavailable?address=%2Fbarproof%2F', stranger)
  await waitFor(async () => expect((await shown()).heading).toBe('Nothing Is Available at /barproof/'), T)
})

test('a person whose place is not the Admin is offered their apps', async ({ createUser }) => {
  const person = await createUser({ email: 'up-app-person@example.test', roles: [] })
  await renderApp('/featherbase/unavailable?address=%2Fequipment%2F', person)
  await waitFor(async () => expect((await shown()).link).toHaveTextContent('Open Your Apps'), T)
  // Their own frame: the sidebar, without the account pages' group.
  expect(screen.getByTestId('account-sidebar')).toBeInTheDocument()
  expect(screen.getByTestId('page-panel')).toContainElement(screen.getByTestId('problem-not-found'))
})

test.for([
  ['//evil.example/'],
  ['https://evil.example/'],
  [`/${'x'.repeat(201)}`],
])('an address that is not a plain path (%s) reads as the address you asked for', async ([address], { admin }) => {
  await renderApp(`/featherbase/unavailable?address=${encodeURIComponent(address!)}`, admin)
  expect((await shown()).heading).toBe('Nothing Is Available at the Address You Asked For')
})

test('signed out, the page says nothing is there, with no frame, and names itself in the tab', async () => {
  await renderApp('/featherbase/unavailable?address=%2Fbarproof%2F', anonymous)
  expect((await shown()).heading).toBe('Nothing Is Available at /barproof/')
  expect(screen.queryByTestId('top-bar')).not.toBeInTheDocument()
  expect(screen.queryByTestId('page-panel')).not.toBeInTheDocument()
  await waitFor(() => expect(document.title).toBe('Not Available · Featherbase'))
})

// Codex adversarial round 2: on an app's own address "/" is that app; the way forward is Featherbase's own address.
test("on an app's own address the way forward is Featherbase's own address", async ({ admin }) => {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/api/brand')) {
      const brand = await (await bridge(input, init)).json()
      return new Response(JSON.stringify({ ...brand, opens: 'dash', home: 'https://featherbase.example.com' }), { headers: { 'content-type': 'application/json' } })
    }
    return bridge(input, init)
  })
  await renderApp('/featherbase/unavailable?address=%2Fdash%2F', admin)
  await waitFor(async () => expect((await shown()).link).toHaveAttribute('href', 'https://featherbase.example.com/'), T)
})
