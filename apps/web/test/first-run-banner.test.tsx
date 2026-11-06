// The way into first-run setup stays open while it is needed (#1003, #1004,
// #1005; item numbers are the checklist on #1003). The sign-in offer is
// one-time and most sign-ins never make it, so nothing here sets it.
import { afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'

afterEach(() => {
  vi.restoreAllMocks()
})

const SETUP = '/featherbase/admin/setup/person'
const MESSAGE = 'No System Manager has an email address, so system notices reach nobody.'
const pathOf = (router: unknown) => (router as { state: { location: { pathname: string } } }).state.location.pathname

async function noManagerEmails() {
  await sql`update person set email = null where row_id in (select parent from has_role where role = 'System Manager')`
  await sql`update sign_in_method set enabled = true, allowed_email_domains = 'example.com' where kind = 'google'`
}

test('items 1, 2, 3: the Administrator is told on a page they went to directly, and cannot dismiss it', async ({ admin }) => {
  await noManagerEmails()
  await renderApp('/featherbase/admin/all-tables', admin)
  const banner = await screen.findByTestId('setup-banner')
  expect(banner).toHaveTextContent(MESSAGE)
  expect(within(banner).getByRole('link', { name: 'Set up administrators' })).toHaveAttribute('href', SETUP)
  expect(within(banner).queryByRole('button')).not.toBeInTheDocument()
})

test('item 1: the Administrator is told on Instance health, where the sign-in offer never reached', async ({ admin }) => {
  await noManagerEmails()
  await renderApp('/featherbase/admin/instance-health', admin)
  expect(await screen.findByTestId('setup-banner')).toHaveTextContent(MESSAGE)
})

test('items 3, 4: the setup screen has no banner, and "Not now" brings it back', async ({ admin }) => {
  await noManagerEmails()
  await renderApp(SETUP, admin)
  const setup = await screen.findByTestId('first-run-setup')
  await screen.findByTestId('setup-administrators-link')
  expect(screen.queryByTestId('setup-banner')).not.toBeInTheDocument()
  await userEvent.click(within(setup).getByRole('button', { name: 'Not now' }))
  expect(await screen.findByTestId('setup-banner')).toBeInTheDocument()
})

test('items 5, 13: inviting someone ends the banner and the sidebar link without a reload', async ({ admin }) => {
  await noManagerEmails()
  await renderApp('/featherbase/admin/all-tables', admin)
  await userEvent.click(within(await screen.findByTestId('setup-banner')).getByRole('link', { name: 'Set up administrators' }))
  const setup = await screen.findByTestId('first-run-setup')
  await userEvent.type(within(setup).getByLabelText('Full name'), 'Asha Keeper')
  await userEvent.type(within(setup).getByLabelText('Email'), 'asha@example.com')
  await userEvent.click(within(setup).getByRole('button', { name: 'Invite' }))
  await screen.findAllByTestId('setup-result')
  await userEvent.click(screen.getByRole('button', { name: 'Continue to Admin' }))
  await waitFor(() => expect(screen.queryByTestId('first-run-setup')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.queryByTestId('setup-administrators-link')).not.toBeInTheDocument())
  expect(screen.queryByTestId('setup-banner')).not.toBeInTheDocument()
})

test('items 6, 11: another System Manager gets no banner or sidebar link, and the card sends them to the Person table', async ({ createUser }) => {
  await noManagerEmails()
  const manager = await createUser({ email: undefined, roles: ['System Manager'] })
  await sql`update person set email = null where row_id = ${manager.user}`
  await renderApp('/featherbase/admin/instance-health', manager)
  const card = await screen.findByTestId('health-check-system-manager-email')
  const link = within(card).getByTestId('health-check-action')
  expect(link).toHaveTextContent('Open the Person table')
  expect(link.getAttribute('href')).toMatch(/\/featherbase\/admin\/table\/person$/)
  expect(screen.queryByTestId('setup-banner')).not.toBeInTheDocument()
  expect(screen.queryByTestId('setup-administrators-link')).not.toBeInTheDocument()
})

test('items 8, 10, 13: the Administrator gets the setup screen from the card and the sidebar, and no fault banner', async ({ admin }) => {
  await noManagerEmails()
  await sql`update scheduled_job set enabled = false`
  await renderApp('/featherbase/admin/instance-health', admin)
  const card = await screen.findByTestId('health-check-system-manager-email')
  const link = within(card).getByTestId('health-check-action')
  expect(link).toHaveTextContent('Set up administrators')
  expect(link).toHaveAttribute('href', SETUP)
  expect(within(screen.getByTestId('admin-sidebar')).getByTestId('setup-administrators-link')).toHaveAttribute('href', SETUP)
  await screen.findByTestId('setup-banner')
  expect(screen.queryByTestId('health-banner')).not.toBeInTheDocument()
})

test('items 12, 13: a passing check shows no banner and no way into setup beyond Welcome', async ({ admin, createUser }) => {
  await createUser({ email: 'keeper@example.com', roles: ['System Manager'] })
  await renderApp('/featherbase/admin/instance-health', admin)
  const card = await screen.findByTestId('health-check-system-manager-email')
  expect(within(card).getByTestId('health-state')).toHaveTextContent('Passing')
  expect(within(card).queryByTestId('health-check-action')).not.toBeInTheDocument()
  expect(screen.getByTestId('welcome-link')).toBeInTheDocument()
  expect(screen.queryByTestId('setup-banner')).not.toBeInTheDocument()
  expect(screen.queryByTestId('setup-administrators-link')).not.toBeInTheDocument()
})

test('items 14, 15: the old address opens the setup screen at the new one', async ({ admin }) => {
  await noManagerEmails()
  const { router } = await renderApp('/featherbase/admin/setup/people', admin)
  expect(await screen.findByTestId('first-run-setup')).toBeInTheDocument()
  await waitFor(() => expect(pathOf(router)).toBe(SETUP))
})
