// #1271: Leavers Who Can Still Sign In, as a System Manager reads it: the shared list of the
// server's rebuilt report, a header saying whether the leaver job disables anyone, and Refresh Now.
import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { sql } from 'server/src/db'
import { configureDelegated } from 'server/test/identity-fixtures'
import { grantRole } from 'server/test/fixtures'
import { rowHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })

test('the list shows its four sections in order, each person with why and how; the header says the leaver job is off', async ({ admin, createUser }) => {
  const gone = await createUser({ email: 'gone.1271@example.com', fullName: 'Gone Leaver' })
  const boss = await createUser({ email: 'boss.1271@example.com', fullName: 'Boss Leaver' })
  const quiet = await createUser({ email: 'quiet.1271@example.com', fullName: 'Quiet Leaver' })
  const out = await createUser({ email: 'out.1271b@example.com', fullName: 'Outside Holder' })
  // Stored out of order: the list follows each row's position, which the rebuild sets section by section.
  await sql`insert into leaver_sign_in (row_id, position, section, person, why, ways_in, left_on) values
    ('r1271d', 3, '4. Not an employee, holds a StyleHR link', ${out.user!}, 'Not an employee, holds a StyleHR link', 'StyleHR', null),
    ('r1271a', 0, '1. Leaver job would disable', ${gone.user!}, 'Exit date 03-Oct-2026 has passed', 'Google, Password', '2026-10-03'),
    ('r1271c', 2, '3. Left, not on the leaver job''s list', ${quiet.user!}, 'The people app says they have left', 'Google', '2026-09-30'),
    ('r1271b', 1, '2. System Manager: never disabled by the job', ${boss.user!}, 'Marked inactive in StyleHR', 'Password', null)`
  await sql`insert into leaver_sign_in_rebuild (id, started_at, summary) values (1, clock_timestamp(), 'The leaver job''s next run would refuse: the warehouse''s StyleHR data is stale')
    on conflict (id) do update set started_at = excluded.started_at, summary = excluded.summary`
  await renderApp('/featherbase/admin/leavers-who-can-sign-in', admin)
  const page = await screen.findByTestId('leavers-who-can-sign-in')
  expect(await within(page).findByText('Exit date 03-Oct-2026 has passed')).toBeInTheDocument()
  expect(within(page).getByText('Google, Password')).toBeInTheDocument()
  // The person opens their own Person page, not the report row.
  expect(await within(page).findByRole('link', { name: /Gone Leaver/ })).toHaveAttribute('href', rowHref('Person', gone.user!))
  const sections = within(page).getAllByRole('cell').map((c) => c.textContent ?? '').filter((t) => /^[1-4]\. /.test(t))
  expect(sections).toEqual([
    '1. Leaver job would disable',
    '2. System Manager: never disabled by the job',
    "3. Left, not on the leaver job's list",
    '4. Not an employee, holds a StyleHR link',
  ])
  expect(await within(page).findByTestId('leaver-job-line')).toHaveTextContent('Leaver job: Off')
  expect(within(page).getByTestId('leaver-job-line')).toHaveTextContent('nobody is disabled while it is off')
  expect(within(page).getByTestId('leaver-checked')).toHaveTextContent("next run would refuse: the warehouse's StyleHR data is stale")
})

// #1271 polish: the title in Title Case counts who can still sign in (sections 1 to 4), and Refresh Now is
// the page's action, with More beside it on the toolbar.
test('the title counts only who can still sign in, and Refresh Now sits on the toolbar with More', async ({ admin, createUser }) => {
  const people = await Promise.all(['one', 'two', 'three'].map((n) => createUser({ email: `count.${n}.1271@example.com` })))
  await sql`insert into leaver_sign_in (row_id, position, section, person, why, ways_in) values
    ('c1', 0, '1. Leaver job would disable', ${people[0].user!}, 'x', 'Password'),
    ('c2', 1, '4. Not an employee, holds a StyleHR link', ${people[1].user!}, 'x', 'StyleHR'),
    ('c3', 2, '5. Not on payroll, but no exit date', ${people[2].user!}, 'x', 'Password')`
  await renderApp('/featherbase/admin/leavers-who-can-sign-in', admin)
  const page = await screen.findByTestId('leavers-who-can-sign-in')
  expect(await within(page).findByRole('heading', { level: 1 })).toHaveTextContent('Leavers Who Can Still Sign In')
  expect(await within(page).findByTestId('leaver-count')).toHaveTextContent('2 can still sign in')
  const toolbar = within(page).getByTestId('list-toolbar')
  expect(within(toolbar).getByTestId('leaver-refresh')).toHaveTextContent('Refresh Now')
  expect(within(toolbar).getByRole('button', { name: /More/ })).toBeInTheDocument()
})

test('a list never rebuilt says it was checked never', async ({ admin }) => {
  await renderApp('/featherbase/admin/leavers-who-can-sign-in', admin)
  expect(await screen.findByTestId('leaver-checked')).toHaveTextContent(/^Checked never$/)
})

test('Refresh Now queues the rebuild and shows its rows once it has run', async ({ admin, createUser }) => {
  await renderApp('/featherbase/admin/leavers-who-can-sign-in', admin)
  await screen.findByTestId('leaver-checked')
  await userEvent.click(await screen.findByTestId('leaver-refresh'))
  await waitFor(() => expect(screen.getByTestId('leaver-refresh')).toHaveTextContent('Refreshing…'))
  await waitFor(async () => expect(await sql`select 1 from background_job where method = 'refresh_leaver_sign_in'`).not.toHaveLength(0))
  // The rebuild finishes (as the job would): a row and a new "Checked" time.
  const late = await createUser({ email: 'late.1271@example.com', fullName: 'Late Leaver' })
  await sql`insert into leaver_sign_in (row_id, position, section, person, why, ways_in) values
    ('r1271late', 0, '1. Leaver job would disable', ${late.user!}, 'Marked inactive in StyleHR', 'Password')`
  await sql`insert into leaver_sign_in_rebuild (id, started_at, summary) values (1, clock_timestamp(), '1 person can still sign in')
    on conflict (id) do update set started_at = excluded.started_at, summary = excluded.summary`
  expect(await screen.findByRole('link', { name: /Late Leaver/ }, { timeout: 10_000 })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('leaver-refresh')).toHaveTextContent('Refresh Now'))
})

test('a Refresh Now the server refuses lets the button be pressed again', async ({ admin }) => {
  const real = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) =>
    /\/api\/leaver_sign_in\/refresh$/.test(new URL(String(url), 'http://localhost').pathname)
      ? Response.json({ error: 'nope' }, { status: 500 }) : real(url, init))
  try {
    await renderApp('/featherbase/admin/leavers-who-can-sign-in', admin)
    await userEvent.click(await screen.findByTestId('leaver-refresh'))
    await waitFor(() => expect(screen.getByTestId('leaver-refresh')).toHaveTextContent('Refresh Now'))
    expect(screen.getByTestId('leaver-refresh')).toBeEnabled()
  } finally { spy.mockRestore() }
})

test('a filter chosen on the list is kept in the address', async ({ admin }) => {
  const app = await renderApp('/featherbase/admin/leavers-who-can-sign-in', admin)
  const page = await screen.findByTestId('leavers-who-can-sign-in')
  await userEvent.selectOptions(await within(page).findByTestId('std-filter-section'), '5. Not on payroll, but no exit date')
  await waitFor(() => expect((app.router.state as { location: { search: { filters?: string } } }).location.search.filters).toContain('5. Not on payroll'))
})

test('a rebuild that failed after the last good one is named, and the rows are said to be older', async ({ admin }) => {
  await sql`insert into leaver_sign_in_rebuild (id, started_at, summary) values (1, now() - interval '1 hour', '0 people can still sign in')`
  await sql`update scheduled_job set last_run_at = now(), last_outcome = 'error', last_result = 'warehouse down' where row_id = 'refresh_leaver_sign_in'`
  await renderApp('/featherbase/admin/leavers-who-can-sign-in', admin)
  expect(await screen.findByTestId('leaver-refresh-failed')).toHaveTextContent(/failed: warehouse down\. These rows are from the last one that worked\./)
})

test('a rebuild that failed before any worked says so', async ({ admin }) => {
  await sql`update scheduled_job set last_run_at = now(), last_outcome = 'error', last_result = 'warehouse down' where row_id = 'refresh_leaver_sign_in'`
  await renderApp('/featherbase/admin/leavers-who-can-sign-in', admin)
  expect(await screen.findByTestId('leaver-refresh-failed')).toHaveTextContent(/failed: warehouse down\. No rebuild has worked yet\.$/)
})

test('a System Manager is offered the list under People and access', async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  expect(await screen.findByTestId('leavers-link')).toHaveAttribute('href', '/featherbase/admin/leavers-who-can-sign-in')
})

test('someone who is not a System Manager is not offered it', async ({ admin, createUser }) => {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Person Reader 1271' } })
  await grantRole(admin, { table: 'Person', role: 'Person Reader 1271', can_read: true })
  const reader = await createUser({ email: 'reader.1271@example.com', roles: ['Person Reader 1271'] })
  await renderApp('/featherbase/admin', reader)
  await screen.findByTestId('sidebar-group-access')
  expect(screen.queryByTestId('leavers-link')).not.toBeInTheDocument()
})

test('an outsider still holding an employees-only link is told to remove it; an employee is not', async ({ admin, createUser }) => {
  await configureDelegated()
  await sql`update sign_in_method set employees_only = true where row_id = 'stylehr'`
  const out = await createUser({ email: 'out.1271@example.com' })
  await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by) values ('uid_out1271', ${out.user!}, 'stylehr', 'RR-1271', 'out', 'Administrator')`
  const real = globalThis.fetch
  let status = 'none'
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) =>
    /\/standing$/.test(new URL(String(url), 'http://localhost').pathname) ? Response.json({ status, code: null, jobs: [], external_label: null }) : real(url, init))
  try {
    const first = await renderApp(rowHref('Person', out.user!), admin)
    const panel = await screen.findByTestId('user-sign-in-methods')
    expect(await within(panel).findByTestId('sign-in-leftover-uid_out1271')).toHaveTextContent('Not an employee: remove this link.')
    first.unmount()
    status = 'current'
    await renderApp(rowHref('Person', out.user!), admin)
    const again = await screen.findByTestId('user-sign-in-methods')
    await within(again).findByTestId('user-method-uid_out1271')
    expect(within(again).queryByTestId('sign-in-leftover-uid_out1271')).not.toBeInTheDocument()
  } finally { spy.mockRestore() }
})
