// The bar bundle's entry (src/bar/main.tsx), as an installed app's served
// document loads it: `<featherbase-bar>` and `<featherbase-sidebar>` become
// custom elements, and a bar host in the page draws the shared top bar into
// its own shadow root (#650). The app page itself is bar-proof's.
import { resolve } from 'node:path'
import { waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { FEATHERBASE_ADMIN_DESTINATION } from 'shared'
import { discoverPackages } from 'server/src/runtime-packages'
import type { TestClient } from 'feather-testing-postgres'
import { setSession } from '../src/lib/api'
import '../src/bar/main'
import { test, expect } from './pg-test'

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')

afterEach(() => {
  document.body.replaceChildren()
  window.history.replaceState(null, '', '/')
})

/** bar-proof's page with the host the server writes first in its body. */
async function appPage(admin: TestClient) {
  expect(await discoverPackages([BAR_PROOF])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
  window.history.replaceState(null, '', '/barproof/')
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  const host = document.createElement('featherbase-bar')
  host.dataset.app = 'barproof'
  host.dataset.title = 'Bar proof'
  document.body.prepend(host)
  return host
}
const barOf = (host: HTMLElement) => within(host.shadowRoot as unknown as HTMLElement)

test('both elements are defined once the bundle loads', () => {
  expect(customElements.get('featherbase-bar')).toBeDefined()
  expect(customElements.get('featherbase-sidebar')).toBeDefined()
})

test("a bar host in an app's page draws the bar with the app's title", async ({ admin }) => {
  const host = await appPage(admin)
  expect(await barOf(host).findByTestId('top-bar-name', {}, { timeout: 8000 })).toHaveTextContent('Bar proof')
})

test('a bar moved within the page is drawn once, not again', async ({ admin }) => {
  const host = await appPage(admin)
  await barOf(host).findByTestId('top-bar-name', {}, { timeout: 8000 })
  document.body.append(host)
  expect(host.shadowRoot!.querySelectorAll('[data-testid="bar-theme-root"]')).toHaveLength(1)
  expect(barOf(host).getAllByTestId('top-bar')).toHaveLength(1)
})

test('choosing Featherbase in the app-name dropdown loads the Admin in place of the app', async ({ admin }) => {
  const host = await appPage(admin)
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const choices = await barOf(host).findByRole('combobox', { name: 'Switch application' }, { timeout: 8000 })
  await within(choices).findByRole('option', { name: FEATHERBASE_ADMIN_DESTINATION.label })
  await userEvent.selectOptions(choices, FEATHERBASE_ADMIN_DESTINATION.href)
  // jsdom cannot load another document; it reports the attempt instead.
  await waitFor(() => expect(errors.mock.calls.some((c) => /Not implemented: navigation/.test(String((c[0] as Error)?.message ?? c[0])))).toBe(true))
})
