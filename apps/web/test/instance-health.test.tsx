// Instance health (#465, tasks 5.3 and 5.4): the health page, and the banner
// every System Manager sees while a check fails. The UI checklist is the
// issue comment on #465; item numbers are cited below.
import { afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { overrideVariable } from 'server/src/env'
import { test, expect, renderApp } from './pg-test'

afterEach(() => {
  vi.restoreAllMocks()
  overrideVariable('GOOGLE_CLIENT_SECRET', undefined)
})

const card = (key: string) => screen.findByTestId(`health-check-${key}`)

/** Every check passes: the file applied, a System Manager with an address,
 *  and no scheduled job running (a switched-off job passes). */
async function healthy(createUser: (o: { email: string; roles: string[] }) => Promise<unknown>) {
  const { applyInstanceSettings } = await import('server/src/instance-settings')
  await applyInstanceSettings({ settings: {} }, { by: 'Administrator' })
  await sql`update scheduled_job set enabled = false`
  // The test database has Google sign-in on, which needs its secret.
  overrideVariable('GOOGLE_CLIENT_SECRET', 'a-test-secret')
  await createUser({ email: 'keeper@example.com', roles: ['System Manager'] })
}

test('never applied: the page says so and how to apply, failing checks first (items 1, 4–7)', async ({ admin }) => {
  await sql`delete from instance_settings_apply`
  await renderApp('/featherbase/admin/instance-health', admin)
  const page = await screen.findByTestId('instance-health')
  expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('Instance health')
  const applied = await card('settings-applied')
  expect(within(applied).getByTestId('health-state')).toHaveTextContent('Failing')
  expect(applied).toHaveTextContent('The settings were never applied.')
  expect(within(applied).getByTestId('health-fix')).toHaveTextContent('cli settings:apply')
  expect(within(applied).getByTestId('health-why')).toHaveTextContent('Why it matters')
  expect(await card('settings-match-file')).toHaveTextContent('Nothing to compare until the settings file is applied.')
  // Failing cards come before passing ones.
  const states = within(page).getAllByTestId('health-state').map((s) => s.textContent)
  expect(states.indexOf('Passing')).toBeGreaterThan(states.lastIndexOf('Failing'))
  expect(page).toHaveTextContent(/\d+ problems? needs? attention\./)
})

test('history: each change of state, with the activity around it one step away (items 8–10)', async ({ admin }) => {
  await sql`delete from instance_settings_apply`
  await sql`delete from health_check_event`
  await sql`insert into health_check_event (check_key, ok, severity, message, at) values
    ('settings-applied', true, 'error', 'Applied.', '2026-10-20T04:30:00Z'),
    ('settings-applied', false, 'error', 'The settings were never applied.', '2026-10-22T09:00:00Z')`
  await renderApp('/featherbase/admin/instance-health', admin)
  const applied = await card('settings-applied')
  const entries = within(applied).getAllByTestId('health-history-entry')
  expect(entries[0]).toHaveTextContent('Failing since 22-Oct-2026 14:30 IST')
  expect(entries[1]).toHaveTextContent('Passing from 20-Oct-2026 10:00 IST to 22-Oct-2026 14:30 IST')
  const link = within(entries[0]).getByRole('link', { name: 'Activity around this change' })
  const url = new URL(link.getAttribute('href')!, 'http://x')
  expect(url.pathname).toBe('/featherbase/admin/Activity%20Log')
  expect(JSON.parse(url.searchParams.get('filters')!)).toEqual([
    ['created_at', '>=', '2026-10-22T08:00:00.000Z'],
    ['created_at', '<=', '2026-10-22T09:15:00.000Z'],
  ])
  expect(within(applied).getByText(/Since 22-Oct-2026 14:30 IST/)).toBeInTheDocument()
})

test('a System Manager sees a red banner leading to the page; it has no close button (items 12–16)', async ({ admin }) => {
  await sql`delete from instance_settings_apply`
  await renderApp('/featherbase/admin/all-tables', admin)
  const banner = await screen.findByTestId('health-banner')
  expect(banner).toHaveAttribute('data-severity', 'error')
  expect(banner).toHaveTextContent(/^\d+ problems? needs? attention/)
  expect(within(banner).getByRole('link', { name: 'Open instance health' })).toHaveAttribute('href', '/featherbase/admin/instance-health')
  expect(within(banner).queryByRole('button')).not.toBeInTheDocument()
  await userEvent.click(within(banner).getByRole('link', { name: 'Open instance health' }))
  expect(await screen.findByTestId('instance-health')).toBeInTheDocument()
  // Every Admin page, the health page included.
  expect(screen.getByTestId('health-banner')).toBeInTheDocument()
})

test('only warnings: the banner is amber; once fixed it goes on the next page change (items 15, 16)', async ({ admin, createUser }) => {
  await healthy(createUser)
  // A break-glass change makes "Settings match the file" a warning.
  const { applyInstanceSettings } = await import('server/src/instance-settings')
  await applyInstanceSettings({ settings: { 'System Settings': { app_name: 'Health Name' } } }, { by: 'Administrator' })
  await sql`update single_value set value = 'Hand Fixed' where table_name = 'System Settings' and field = 'app_name'`
  await renderApp('/featherbase/admin/all-tables', admin)
  const banner = await screen.findByTestId('health-banner')
  expect(banner).toHaveAttribute('data-severity', 'warning')
  expect(banner).toHaveTextContent('1 problem needs attention')

  await sql`update single_value set value = 'Health Name' where table_name = 'System Settings' and field = 'app_name'`
  await userEvent.click(screen.getByTestId('instance-health-link'))
  await screen.findByTestId('instance-health')
  await waitFor(() => expect(screen.queryByTestId('health-banner')).not.toBeInTheDocument())
  expect(await screen.findByTestId('instance-health-summary')).toHaveTextContent('Every check passes.')
})

test('someone without the System Manager role sees no banner, no link and never asks (item 13)', async ({ admin, createUser }) => {
  await sql`delete from instance_settings_apply`
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Shelf Clerk' } })
  await admin.post('/api/table_def', { name: 'Shelf Note', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Shelf Note', role: 'Shelf Clerk', can_read: true } })
  const clerk = await createUser({ email: 'clerk.health@example.com', roles: ['Shelf Clerk'] })
  const urls: string[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.pathname : (input as Request).url)
    return real(input, init)
  })
  await renderApp('/featherbase/admin/instance-health', clerk)
  await screen.findByTestId('all-tables-link')
  expect(screen.queryByTestId('health-banner')).not.toBeInTheDocument()
  expect(screen.queryByTestId('instance-health')).not.toBeInTheDocument()
  expect(screen.queryByTestId('instance-health-link')).not.toBeInTheDocument()
  expect(urls.filter((u) => u.includes('instance-health'))).toEqual([])
})
