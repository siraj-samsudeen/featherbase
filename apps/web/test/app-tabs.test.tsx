// #380 task 4.4: an app may declare the tabs its staff move between on a
// phone (manifest `tabs`, version 1), and the shared top bar draws them as the
// Shop Floor TabBar — on a phone, on that app's pages only. No app declares
// any yet (Feather Dash fills them in later), so nothing changes for staff.
import { render, screen, within } from '@testing-library/react'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, vi } from 'vitest'
import { ACCOUNT_SIGN_IN_METHODS_PATH } from 'shared'
import { config } from 'server/src/config'
import { parseInstanceAddresses } from 'server/src/instance-addresses'
import { discoverPackages } from 'server/src/runtime-packages'
import { PHONE_QUERY } from '../src/components/TopBar'
import { TabBar } from '../src/components/ui'
import { House, Target } from '../src/components/ui/icons'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]

let staged: string | undefined
afterEach(async () => {
  config.instanceAddresses = null
  vi.restoreAllMocks()
  if (staged) await rm(staged, { recursive: true, force: true })
  staged = undefined
})

function width(phone: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: phone && q === PHONE_QUERY, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList)
}

function onAddressThatOpens(opens: string) {
  config.instanceAddresses = parseInstanceAddresses(
    JSON.stringify([{ address: 'http://localhost', opens, emails: true }, { address: 'http://elsewhere.example.test', opens: 'admin' }]),
    'test',
  )
}

/** The test app "other", installed, declaring `tabs` (or none). */
async function installOther(admin: Admin, tabs?: unknown) {
  staged = await mkdtemp(resolve('test/.app-tabs-'))
  await cp(resolve('../..', 'runtime-apps/other'), staged, { recursive: true })
  const file = resolve(staged, 'featherbase.json')
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), ...(tabs ? { tabs } : {}) }))
  expect(await discoverPackages([staged])).toEqual([])
  await admin.post('/api/install_app', { name: 'other' })
}

const TABS = { version: 1, items: [
  { label: 'Today', icon: 'home', path: '' },
  { label: 'Targets', icon: 'target', path: 'targets' },
  { label: 'Account', icon: 'person', path: 'account' },
] }

// ---- the primitive -------------------------------------------------------------

test('the TabBar is a labelled set of links, each with an icon and a label, the current one marked', () => {
  render(
    <TabBar
      label="Sections"
      tabs={[
        { label: 'Today', icon: House, href: '/a/' },
        { label: 'Targets', icon: Target, href: '/a/targets', current: true },
      ]}
    />,
  )
  const nav = screen.getByRole('navigation', { name: 'Sections' })
  const links = within(nav).getAllByRole('link')
  expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([['Today', '/a/'], ['Targets', '/a/targets']])
  for (const link of links) {
    expect(link.querySelector('svg')).not.toBeNull()
    // 48px each way: a thumb-sized target (usable-on-any-device).
    expect(link.className).toMatch(/\bmin-h-touch\b/)
  }
  expect(links[1]).toHaveAttribute('aria-current', 'page')
  expect(links[0]).not.toHaveAttribute('aria-current')
  // Phone only: a wide screen never draws it, whoever renders it.
  expect(nav.className).toMatch(/\bsm:hidden\b/)
})

// ---- the shared top bar --------------------------------------------------------

test("on a phone, an app's declared tabs are drawn on its pages, the one open marked", async ({ admin }) => {
  width(true)
  await installOther(admin, TABS)
  onAddressThatOpens('other')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  const nav = await screen.findByRole('navigation', { name: 'Other tasks' })
  expect(within(nav).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
    ['Today', '/other/'],
    ['Targets', '/other/targets'],
    ['Account', '/other/account'],
  ])
  // The account page is not one of the app's tabs, so none is current.
  expect(within(nav).queryByRole('link', { current: 'page' })).toBeNull()
})

test('on a wide screen the same app draws no tab bar', async ({ admin }) => {
  width(false)
  await installOther(admin, TABS)
  onAddressThatOpens('other')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  await screen.findByTestId('session-user')
  expect(screen.queryByTestId('tab-bar')).toBeNull()
})

test('on a phone, an app that declares no tabs gets no tab bar', async ({ admin }) => {
  width(true)
  await installOther(admin)
  onAddressThatOpens('other')
  await renderApp(ACCOUNT_SIGN_IN_METHODS_PATH, admin)
  await screen.findByTestId('session-user')
  expect(screen.queryByTestId('tab-bar')).toBeNull()
})

test('on a phone, the Admin screens draw no tab bar', async ({ admin }) => {
  width(true)
  await installOther(admin, TABS)
  await renderApp('/featherbase/admin', admin)
  await screen.findByTestId('session-user')
  expect(screen.queryByTestId('tab-bar')).toBeNull()
})

test('on a phone, Feather Dash draws no tab bar until it declares tabs', async ({ admin }) => {
  width(true)
  await renderApp('/featherbase/sales-target', admin)
  await screen.findByTestId('session-user')
  expect(screen.queryByTestId('tab-bar')).toBeNull()
})
