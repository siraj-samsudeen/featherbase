// First-run setup (#465, task 6.1; checklist items 18–25 on #465). Offered to
// the built-in Administrator when they sign in and no System Manager has an
// email address; "Not now" reaches the Admin at once and the banner stays.
import { afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { OFFER_SETUP_KEY } from '../src/pages/FirstRunSetup'
import { test, expect, renderApp } from './pg-test'

afterEach(() => {
  vi.restoreAllMocks()
  try { sessionStorage.clear() } catch { /* storage blocked */ }
})

async function noManagerEmails() {
  await sql`update person set email = null where row_id in (select parent from has_role where role = 'System Manager')`
  await sql`update sign_in_method set enabled = true, allowed_email_domains = 'example.com' where kind = 'google'`
}

/** What the sign-in page leaves behind for the Administrator. */
const justSignedIn = () => sessionStorage.setItem(OFFER_SETUP_KEY, '1')

test('a pending sign-in offer never takes over a new-row deep link after readiness resolves', async ({ admin }) => {
  await noManagerEmails()
  await sql`update scheduled_job set enabled = true, last_run_at = now(), last_outcome = 'error' where method = 'disable_leavers'`
  justSignedIn()
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/api/instance-health')) await held
    return real(input, init)
  })
  const path = '/featherbase/admin/table/person/new'
  const { router } = await renderApp(path, admin)
  try {
    expect(await screen.findByTestId('form-view')).toBeInTheDocument()
  } finally {
    release()
  }
  await screen.findByTestId('health-banner')
  await waitFor(() => expect(sessionStorage.getItem(OFFER_SETUP_KEY)).toBeNull())
  expect((router.state as { location: { pathname: string } }).location.pathname).toBe(path)
  expect(screen.getByTestId('form-view')).toBeInTheDocument()
  expect(screen.queryByTestId('welcome-setup')).not.toBeInTheDocument()
})

test('an absent sign-in offer leaves Admin home available with setup unfinished', async ({ admin }) => {
  await noManagerEmails()
  await sql`update scheduled_job set enabled = true, last_run_at = now(), last_outcome = 'error' where method = 'disable_leavers'`
  const { router } = await renderApp('/featherbase/admin/home/system', admin)
  await screen.findByTestId('health-banner')
  expect((router.state as { location: { pathname: string } }).location.pathname).toBe('/featherbase/admin/home/system')
  expect(screen.queryByTestId('welcome-setup')).not.toBeInTheDocument()
})

test('signing in welcomes the first administrator with optional next steps', async ({ admin }) => {
  await noManagerEmails()
  justSignedIn()
  await renderApp('/featherbase/admin', admin)
  const setup = await screen.findByTestId('welcome-setup')
  expect(within(setup).getByRole('heading', { level: 1 })).toHaveTextContent('Welcome to Featherbase')
  expect(within(setup).getByRole('link', { name: 'Browse apps' })).toBeInTheDocument()
  expect(within(setup).getByRole('link', { name: 'Set up administrators' })).toBeInTheDocument()
  expect(within(setup).getByRole('link', { name: 'Explore Featherbase' })).toBeInTheDocument()
})

test('exploring past setup keeps a genuine job failure visible', async ({ admin }) => {
  await noManagerEmails()
  await sql`update scheduled_job set enabled = true, last_run_at = now(), last_outcome = 'error' where method = 'disable_leavers'`
  justSignedIn()
  await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByRole('link', { name: 'Explore Featherbase' }))
  await waitFor(() => expect(screen.queryByTestId('welcome-setup')).not.toBeInTheDocument())
  expect(await screen.findByTestId('health-banner')).toBeInTheDocument()
  // The offer is spent: going home again does not ask again.
  await userEvent.click(screen.getByTestId('all-tables-link'))
  expect(screen.queryByTestId('first-run-setup')).not.toBeInTheDocument()
})

test('with the email sink, Invite shows each person with their invitation to copy (items 21, 23, 24)', async ({ admin }) => {
  await noManagerEmails()
  await renderApp('/featherbase/admin/setup/person', admin)
  const setup = await screen.findByTestId('first-run-setup')
  await userEvent.type(within(setup).getByLabelText('Full name'), 'Asha Keeper')
  await userEvent.type(within(setup).getByLabelText('Email'), 'asha@example.com')
  await userEvent.click(within(setup).getByRole('button', { name: 'Add another person' }))
  const names = within(setup).getAllByLabelText('Full name')
  const emails = within(setup).getAllByLabelText('Email')
  expect(names).toHaveLength(2)
  await userEvent.type(names[1], 'Ravi Kumar')
  await userEvent.type(emails[1], 'ravi@example.com')
  await userEvent.click(within(setup).getByRole('button', { name: 'Invite' }))

  const results = await screen.findAllByTestId('setup-result')
  expect(results).toHaveLength(2)
  expect(results[0]).toHaveTextContent('Asha Keeper is invited as a System Manager')
  expect(within(results[0]).getByTestId('setup-invitation')).toHaveTextContent('/featherbase/login')
  expect(within(results[0]).getByTestId('setup-invitation')).toHaveTextContent('asha@example.com')
  expect(within(results[0]).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  const roles = await sql`select r.role from person p join has_role r on r.parent = p.row_id where p.email = 'ravi@example.com'`
  expect(roles.map((r) => r.role)).toContain('System Manager')
  // Done: the way on, and the banner has gone.
  await userEvent.click(screen.getByRole('button', { name: 'Continue to Admin' }))
  await waitFor(() => expect(screen.queryByTestId('first-run-setup')).not.toBeInTheDocument())
})

test('problems show beside their row and nothing is created (item 22)', async ({ admin }) => {
  await noManagerEmails()
  await renderApp('/featherbase/admin/setup/person', admin)
  const setup = await screen.findByTestId('first-run-setup')
  await userEvent.click(within(setup).getByRole('button', { name: 'Invite' }))
  expect(await within(setup).findByText('Enter an email address')).toBeInTheDocument()
  await userEvent.type(within(setup).getByLabelText('Email'), 'dup@example.com')
  await userEvent.click(within(setup).getByRole('button', { name: 'Add another person' }))
  await userEvent.type(within(setup).getAllByLabelText('Email')[1], 'DUP@example.com')
  await userEvent.click(within(setup).getByRole('button', { name: 'Invite' }))
  expect(await within(setup).findByText('The same address as person 1')).toBeInTheDocument()
  expect((await sql`select 1 from person where lower(email) = 'dup@example.com'`).length).toBe(0)
})

test('another System Manager is never offered the setup (item 18)', async ({ createUser }) => {
  await noManagerEmails()
  const manager = await createUser({ email: undefined, roles: ['System Manager'] })
  await sql`update person set email = null where row_id = ${manager.user}`
  justSignedIn()
  await renderApp('/featherbase/admin/all-tables', manager)
  await screen.findByTestId('all-tables-link')
  expect(screen.queryByTestId('welcome-setup')).not.toBeInTheDocument()
  expect(screen.queryByTestId('first-run-setup')).not.toBeInTheDocument()
  const { router } = await renderApp('/featherbase/admin/setup/person', manager)
  await waitFor(() => expect((router.state as { location: { pathname: string } }).location.pathname).toBe('/featherbase/admin'))
  await waitFor(() => expect(screen.queryByTestId('first-run-setup')).not.toBeInTheDocument())
})

test('a row can be removed, and a server problem with no field of its own is still shown (Codex review)', async ({ admin }) => {
  await noManagerEmails()
  await renderApp('/featherbase/admin/setup/person', admin)
  const setup = await screen.findByTestId('first-run-setup')
  await userEvent.click(within(setup).getByRole('button', { name: 'Add another person' }))
  expect(within(setup).getAllByLabelText('Email')).toHaveLength(2)
  await userEvent.click(within(setup).getByRole('button', { name: 'Remove person 2' }))
  expect(within(setup).getAllByLabelText('Email')).toHaveLength(1)
  // The server refuses for a reason no field carries: it is shown, not swallowed.
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/api/setup/system-managers'))
      return Promise.resolve(new Response(JSON.stringify({ error: { type: 'ValidationError', message: 'Name at most 20 people', fields: { people: 'too many' } } }), { status: 417, headers: { 'content-type': 'application/json' } }))
    return real(input, init)
  })
  await userEvent.type(within(setup).getByLabelText('Email'), 'one@example.com')
  await userEvent.click(within(setup).getByRole('button', { name: 'Invite' }))
  expect(await within(setup).findByText(/Name at most 20 people/)).toBeInTheDocument()
})

test('a slow health answer never pulls the Administrator off a page they moved on to (Codex review)', async ({ admin }) => {
  await noManagerEmails()
  await sql`update scheduled_job set enabled = true, last_run_at = now(), last_outcome = 'error' where method = 'disable_leavers'`
  justSignedIn()
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/api/instance-health')) await held
    return real(input, init)
  })
  await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('all-tables-link'))
  release()
  await screen.findByTestId('health-banner')
  expect(screen.queryByTestId('welcome-setup')).not.toBeInTheDocument()
  expect(screen.queryByTestId('first-run-setup')).not.toBeInTheDocument()
})

const urlOf = (input: unknown) => typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url

/** The setup answer for one person, as the server would give it. */
function answerSetup(invitation: Record<string, unknown>) {
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (urlOf(input).includes('/api/setup/system-managers'))
      return Promise.resolve(new Response(JSON.stringify({ people: [{ person: 'psn_asha', full_name: 'Asha Keeper', email: 'asha@example.com', created: true, invitation }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }))
    return real(input, init)
  })
}

async function inviteAsha(admin: Parameters<typeof renderApp>[1]) {
  await renderApp('/featherbase/admin/setup/person', admin)
  const setup = await screen.findByTestId('first-run-setup')
  await userEvent.type(within(setup).getByLabelText('Full name'), 'Asha Keeper')
  await userEvent.type(within(setup).getByLabelText('Email'), 'asha@example.com')
  await userEvent.click(within(setup).getByRole('button', { name: 'Invite' }))
  return setup
}

test.for([
  ['sent', { status: 'sent' }, 'The invitation email was sent to asha@example.com.', false],
  ['failed with a link to copy', { status: 'failed', error: 'The mail server refused it', link: 'https://example.test/featherbase/login', method_label: 'Google' },
    'The mail server refused it. Copy this invitation and send it to them yourself.', true],
  ['failed with nothing to copy', { status: 'failed', error: 'The mail server refused it', link: null, method_label: 'Google' }, 'The mail server refused it.', false],
  ['not possible by any sign-in method', { status: 'no_method' }, 'No sign-in method can invite them yet.', false],
] as const)('an invitation %s says so', async ([, invitation, words, copy], { admin }) => {
  await noManagerEmails()
  answerSetup(invitation)
  await inviteAsha(admin)
  const result = await screen.findByTestId('setup-result')
  expect(result).toHaveTextContent(words)
  expect(within(result).queryByRole('button', { name: 'Copy' }) !== null).toBe(copy)
})

test.for([
  ['a dropped connection', new TypeError('Failed to fetch'), 'Failed to fetch'],
  ['something other than an error', 'offline', 'The people could not be set up'],
] as const)('an invite cut off by %s says what went wrong', async ([, failure, words], { admin }) => {
  await noManagerEmails()
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    urlOf(input).includes('/api/setup/system-managers') ? Promise.reject(failure) : real(input, init))
  const setup = await inviteAsha(admin)
  expect(await within(setup).findByText(words)).toBeInTheDocument()
})

test('a finished setup run from a settings file reads Ready at each step', async ({ admin }) => {
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const res = await real(input, init)
    if (!urlOf(input).includes('/api/instance-health')) return res
    const health = await res.json() as { setup_needed: boolean; setup: Record<string, unknown> }
    return new Response(JSON.stringify({ ...health, setup_needed: false,
      setup: { ...health.setup, administrator_ready: true, environment: 'production', configuration: 'file' } }),
    { status: 200, headers: { 'content-type': 'application/json' } })
  })
  await renderApp('/featherbase/admin/setup', admin)
  const setup = await screen.findByTestId('welcome-setup')
  const step = (heading: string) => within(setup).getByRole('heading', { name: heading }).closest('section')!
  await within(setup).findByRole('heading', { name: '1. Set up your administrators' })
  expect(step('1. Set up your administrators')).toHaveTextContent('Ready')
  expect(step('3. Prepare for shared use')).toHaveTextContent(/ReadyReview sign-in.*Your instance uses a managed settings file\./)
})

test('setup progress the network could not load says so, and Try again loads it', async ({ admin }) => {
  let down = true
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (down && url.includes('/api/instance-health')) throw new TypeError('Failed to fetch')
    return real(input, init)
  })
  await renderApp('/featherbase/admin/setup', admin)
  const setup = await screen.findByTestId('welcome-setup')
  expect(await within(setup).findByText(/Setup progress could not be loaded/)).toBeInTheDocument()
  down = false
  await userEvent.click(within(setup).getByRole('button', { name: 'Try again' }))
  expect(await within(setup).findByRole('link', { name: 'Set up administrators' })).toBeInTheDocument()
  expect(within(setup).queryByText(/Setup progress could not be loaded/)).not.toBeInTheDocument()
})
