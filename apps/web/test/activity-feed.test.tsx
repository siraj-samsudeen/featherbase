// #440: the homepage activity feed is readable — initials come from the
// person's name, "filtered" only when a filter was applied, fixed admin pages
// show their title, and the Team tab names the person with their main role.

import { screen, waitFor, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'
import { sql } from 'server/src/db'
import { logActivity } from 'server/src/audit'
import { feedVerb, initials } from '../src/components/ActivityFeed'

test('initials come from the display name, verbs from whether a filter exists', () => {
  expect(initials('Feed Tester')).toBe('FT')
  expect(initials('jo.nameless')).toBe('JN')
  expect(feedVerb({ kind: 'list', filtered: false })).toBe('opened')
  expect(feedVerb({ kind: 'list' })).toBe('opened')
  expect(feedVerb({ kind: 'list', filtered: true })).toBe('filtered')
  expect(feedVerb({ kind: 'row' })).toBe('opened')
})

test('My activity: initials from the name, honest verbs, page titles, "List" pill, no name column', async ({
  createUser,
}) => {
  const me = await createUser({ roles: ['System Manager'], fullName: 'Sample Person' })
  const filters = JSON.stringify([['status', '=', 'Overdue']])
  await me.post('/api/events', {
    events: [
      { kind: 'list', key: 'list:Task?', label: 'Task', path: '/featherbase/admin/Task' },
      { kind: 'list', key: `list:Task?${filters}`, label: 'Task', sub: 'status = Overdue' },
      { kind: 'list', key: 'list:sign-in-methods?', label: 'sign-in-methods', path: '/featherbase/admin/sign-in-methods' },
    ],
  })
  await renderApp('/featherbase/admin', me)
  const feed = await screen.findByTestId('activity-feed')
  await waitFor(() => expect(within(feed).getAllByTestId('feed-item')).toHaveLength(3))
  const rows = within(feed).getAllByTestId('feed-item')
  const text = rows.map((r) => r.textContent ?? '')
  expect(text.filter((t) => t.includes('filtered'))).toHaveLength(1)
  expect(text.filter((t) => t.includes('opened Task'))).toHaveLength(1)
  expect(text.some((t) => t.includes('Sign-in methods'))).toBe(true)
  expect(text.some((t) => t.includes('sign-in-methods'))).toBe(false)
  for (const r of rows) {
    expect(r.textContent).toContain('SP') // initials of "Sample Person", not "P" from psn_…
    expect(r.textContent).not.toMatch(/\bVIEW\b/i)
    expect(within(r).queryByTestId('feed-who')).toBeNull()
  }
  expect(text.some((t) => /list/i.test(t))).toBe(true)
})

test('Team tab: name, then main role; nameless person falls back to the email local part', async ({
  createUser,
}) => {
  const mgr = await createUser({ roles: ['System Manager'], fullName: 'Team Lead' })
  const bare = await createUser({ roles: [], email: 'jo.nameless@x.com', fullName: '' })
  // Version rows are what the Team tab shows; attribute one edit to each.
  await mgr.post('/api/table_def', {
    name: 'Feed Web DT',
    id_pattern: 'prompt',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  for (const [u, id] of [[mgr, 'w-mgr'], [bare, 'w-bare']] as const) {
    const c = await mgr.post<{ updated_at: string }>('/api/save_row', {
      table: 'Feed Web DT', row: { row_id: id, title: 'v1' },
    })
    await mgr.post('/api/save_row', {
      table: 'Feed Web DT', row: { row_id: id, title: 'v2', updated_at: c.updated_at },
    })
    await sql`update version set created_by = ${u.user} where ref_name = ${id}`
  }
  await renderApp('/featherbase/admin', mgr)
  const feed = await screen.findByTestId('activity-feed')
  ;(await within(feed).findByTestId('feed-tab-team')).click()
  await waitFor(() => expect(within(feed).getAllByTestId('feed-who').length).toBeGreaterThan(0))
  const whos = within(feed).getAllByTestId('feed-who').map((e) => e.textContent)
  expect(whos).toContain('Team Lead')
  expect(whos).toContain('jo.nameless')
  const leadRow = within(feed).getAllByTestId('feed-item').find((r) => r.textContent?.includes('w-mgr'))!
  expect(within(leadRow).getByTestId('feed-role')).toHaveTextContent('System Manager')
  const bareRow = within(feed).getAllByTestId('feed-item').find((r) => r.textContent?.includes('w-bare'))!
  expect(within(bareRow).queryByTestId('feed-role')).toBeNull()
  expect(leadRow.textContent).toContain('TL')
  expect(bareRow.textContent).toContain('JN')
  expect(whos.every((w) => !w?.startsWith('psn_'))).toBe(true)
  expect(feed.textContent).not.toContain('@x.com')
})

test('Team tab: a sign-in row shows the person once and never an opaque id', async ({ createUser }) => {
  const mgr = await createUser({ roles: ['System Manager'], fullName: 'Login Lead' })
  const bare = await createUser({ roles: [], email: 'quiet.person@x.com', fullName: '' })
  await logActivity(mgr.user!, 'login', { full_name: 'Login Lead' })
  await logActivity(bare.user!, 'login', { full_name: null })
  await renderApp('/featherbase/admin', mgr)
  const feed = await screen.findByTestId('activity-feed')
  ;(await within(feed).findByTestId('feed-tab-team')).click()
  await waitFor(() =>
    expect(within(feed).getAllByTestId('feed-item').filter((r) => r.textContent?.includes('signed in')).length).toBeGreaterThanOrEqual(2),
  )
  const logins = within(feed).getAllByTestId('feed-item').filter((r) => r.textContent?.includes('signed in'))
  for (const r of logins) expect(r.textContent).not.toContain('psn_')
  for (const r of logins.filter((r) => r.textContent?.includes('Login Lead')))
    expect(r.textContent!.match(/Login Lead/g)).toHaveLength(1)
  expect(logins.some((r) => r.textContent?.includes('quiet.person'))).toBe(true)
})
