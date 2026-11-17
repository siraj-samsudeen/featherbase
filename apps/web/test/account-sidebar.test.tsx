// #1235 item 7 / what-you-can-see 1 (UI standard §4): the account pages open in a
// frame with the shared sidebar, an "Account" group (Sign-in methods, What you can
// see) at its top, and the page at the shared x (32px from the sidebar, left-aligned,
// at most 880px wide; standard X1).
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
  expect(groupLinks(account)).toEqual(['Sign-in methods', 'What you can see'])
  // At the top: nothing of the sidebar's comes before it.
  expect(sidebar.firstElementChild).toBe(account)
  const selected = within(account).getByRole('link', { name: 'Sign-in methods' })
  expect(selected).toHaveAttribute('aria-current', 'page')
  // Verifier, round 5: selected reads in the action colour, never also the muted one.
  expect(selected.className).toMatch(/\btext-action\b/)
  expect(selected.className).not.toMatch(/\btext-ink-muted\b/)
  expect(within(account).getByRole('link', { name: 'What you can see' }).className).toMatch(/\btext-ink-muted\b/)
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
  expect(groupLinks(account)).toEqual(['Sign-in methods', 'What you can see'])
  expect(screen.queryByTestId('admin-sidebar')).not.toBeInTheDocument()
  // The bar works this sidebar as it does every other (#1227).
  const collapse = await screen.findByTestId('sidebar-collapse', {}, WAIT)
  await userEvent.click(collapse)
  await waitFor(() => expect(sidebar).toHaveAttribute('data-collapsed', 'true'), WAIT)
  await userEvent.click(collapse)
  await waitFor(() => expect(sidebar).not.toHaveAttribute('data-collapsed'), WAIT)

  // The sidebar's What you can see is the person's own page.
  await userEvent.click(within(account).getByRole('link', { name: 'What you can see' }))
  await waitFor(() => expect(screen.getByTestId('access-explanation-heading')).toHaveTextContent('What you can see'), WAIT)
  expect(within(account).getByRole('link', { name: 'What you can see' })).toHaveAttribute('aria-current', 'page')
})

test('the account page starts at the shared x (20px), left-aligned, at most 880px wide', async ({ createUser }) => {
  const me = await createUser({ roles: [] })
  await renderApp('/featherbase/account/sign-in-methods', me)
  const content = await screen.findByTestId('account-content', {}, WAIT)
  expect(content.className).toContain('max-w-[880px]')
  expect(content.className).not.toContain('mx-auto')
  // #1249: the shared x is 20px from the sidebar (was 32), with 16px above.
  expect(content.closest('main')!.className).toContain('sm:px-5')
  expect(content.closest('main')!.className).toContain('sm:py-4')
})
