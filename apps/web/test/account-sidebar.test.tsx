// #1235 item 7 / what-you-can-see 1 (UI standard §4): the account pages open in a
// frame with the shared sidebar, an "Account" group (Sign-In Methods, Connected Apps
// (#1207), What You Can See) at its top, and the page at the shared x (32px from the
// sidebar, left-aligned; #1385: filling the space after the sidebar, uncapped).
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const WAIT = { timeout: 10_000 }
const groupLinks = (group: HTMLElement) => within(group).getAllByRole('link').map((a) => a.textContent?.trim())

test('in the Admin frame the account pages put the Account group at the top of the sidebar', async ({ admin }) => {
  await renderApp('/featherbase/account/sign-in-methods', admin)
  const sidebar = await screen.findByTestId('admin-sidebar', {}, WAIT)
  const account = await within(sidebar).findByTestId('sidebar-group-account', {}, WAIT)
  expect(within(account).getByTestId('sidebar-group-heading')).toHaveTextContent(/^Account$/)
  expect(groupLinks(account)).toEqual(['Sign-In Methods', 'Connected Apps', 'What You Can See'])
  // At the top of the links: only the switcher and the command field (#1253) come before it.
  expect(within(sidebar).getByTestId('sidebar-links').firstElementChild).toBe(account)
  const selected = within(account).getByRole('link', { name: 'Sign-In Methods' })
  expect(selected).toHaveAttribute('aria-current', 'page')
  // #1253 (Quiet Canvas): the open page is a white tile with a soft shadow; the others are plain.
  expect(selected.className).toMatch(/\bbg-surface\b.*\bshadow-sm\b/)
  expect(within(account).getByRole('link', { name: 'What You Can See' }).className).not.toMatch(/\bbg-surface\b/)
})

test('the Admin pages that are not account pages have no Account group', async ({ admin }) => {
  await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('sidebar-group-data', {}, WAIT)
  expect(screen.queryByTestId('sidebar-group-account')).not.toBeInTheDocument()
})

test('someone without Admin reads the account pages beside a sidebar of their own, with the shared controls', async ({ createUser }) => {
  const me = await createUser({ roles: [] })
  await renderApp('/featherbase/account/sign-in-methods', me)
  const frame = await screen.findByTestId('account-layout', {}, WAIT)
  const sidebar = await within(frame).findByTestId('account-sidebar', {}, WAIT)
  const account = within(sidebar).getByTestId('sidebar-group-account')
  expect(groupLinks(account)).toEqual(['Sign-In Methods', 'Connected Apps', 'What You Can See'])
  expect(screen.queryByTestId('admin-sidebar')).not.toBeInTheDocument()
  // The bar works this sidebar as it does every other (#1227).
  const collapse = await screen.findByTestId('sidebar-collapse', {}, WAIT)
  await userEvent.click(collapse)
  await waitFor(() => expect(sidebar).toHaveAttribute('data-collapsed', 'true'), WAIT)
  await userEvent.click(collapse)
  await waitFor(() => expect(sidebar).not.toHaveAttribute('data-collapsed'), WAIT)

  // The sidebar's What You Can See is the person's own page.
  await userEvent.click(within(account).getByRole('link', { name: 'What You Can See' }))
  await waitFor(() => expect(screen.getByTestId('access-explanation-heading')).toHaveTextContent('What You Can See'), WAIT)
  expect(within(account).getByRole('link', { name: 'What You Can See' })).toHaveAttribute('aria-current', 'page')
})

test('the account page starts at the shared x (28px), left-aligned, and fills the space after the sidebar (#1385)', async ({ createUser }) => {
  const me = await createUser({ roles: [] })
  await renderApp('/featherbase/account/sign-in-methods', me)
  const content = await screen.findByTestId('account-content', {}, WAIT)
  expect(content.className).not.toMatch(/max-w-/)
  expect(content.className).not.toContain('mx-auto')
  // #1348 board 2: the shared x is 28px from the panel's edge, with 24px above.
  expect(content.closest('main')!.className).toContain('sm:px-7')
  expect(content.closest('main')!.className).toContain('sm:py-6')
})
