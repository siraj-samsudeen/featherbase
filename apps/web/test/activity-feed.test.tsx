// #440: the homepage activity feed is readable — rows never show an opaque
// id, "filtered" only when a filter was applied, fixed admin pages
// show their title, and the Team tab names the person with their main role.

import { screen, waitFor, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'
import { sql } from 'server/src/db'
import { logActivity } from 'server/src/audit'
import { feedVerb, groupByDay } from '../src/components/ActivityFeed'
import { fmtTimelineDay } from '../src/lib/inr'

test('verbs come from whether a filter exists', () => {
  expect(feedVerb({ kind: 'list', filtered: false })).toBe('opened')
  expect(feedVerb({ kind: 'list' })).toBe('opened')
  expect(feedVerb({ kind: 'list', filtered: true })).toBe('filtered')
  expect(feedVerb({ kind: 'row' })).toBe('opened')
})

test('day headings: Today, Yesterday, then weekday and DD-Mon-YYYY', () => {
  const now = new Date(2026, 9, 26, 10, 0)
  expect(fmtTimelineDay(new Date(2026, 9, 26, 0, 5), now)).toBe('Today')
  expect(fmtTimelineDay(new Date(2026, 9, 25, 23, 59), now)).toBe('Yesterday')
  expect(fmtTimelineDay(new Date(2026, 9, 13, 9, 0), now)).toBe('Tue, 13-Oct-2026')
  const at = (d: number, h: number) => new Date(2026, 9, d, h).toISOString()
  const groups = groupByDay([{ at: at(26, 9) }, { at: at(26, 8) }, { at: at(13, 9) }], now)
  expect(groups.map((g) => [g.heading, g.items.length])).toEqual([['Today', 2], ['Tue, 13-Oct-2026', 1]])
})

test('My activity: honest verbs, page titles, a List icon, "You" as the subject', async ({
  createUser,
}) => {
  const me = await createUser({ roles: ['System Manager'], fullName: 'Sample Person' })
  const filters = JSON.stringify([['status', '=', 'Overdue']])
  await me.post('/api/events', {
    events: [
      { kind: 'list', key: 'list:Task?', label: 'Task', path: '/featherbase/admin/Task' },
      { kind: 'list', key: `list:Task?${filters}`, label: 'Task', sub: 'status = Overdue' },
      { kind: 'list', key: 'list:access-tokens?', label: 'access-tokens', path: '/featherbase/admin/access-tokens' },
    ],
  })
  await renderApp('/featherbase/admin', me)
  const feed = await screen.findByTestId('activity-feed')
  await waitFor(() => expect(within(feed).getAllByTestId('feed-item')).toHaveLength(3))
  const rows = within(feed).getAllByTestId('feed-item')
  const text = rows.map((r) => r.textContent ?? '')
  expect(text.filter((t) => t.includes('filtered'))).toHaveLength(1)
  expect(text.filter((t) => t.includes('opened Task'))).toHaveLength(1)
  expect(text.some((t) => t.includes('Access tokens'))).toBe(true)
  expect(text.some((t) => t.includes('access-tokens'))).toBe(false)
  for (const r of rows) {
    expect(r.textContent).not.toContain('psn_')
    expect(r.textContent).not.toMatch(/\bVIEW\b/i)
    expect(within(r).getByTestId('feed-who')).toHaveTextContent(/^You$/)
  }
  expect(within(feed).getAllByRole('img', { name: 'List' }).length).toBeGreaterThan(0)
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
  // Rows show the row's title now ("v2" for both), so find them by person.
  const rowOf = (who: string) =>
    within(feed).getAllByTestId('feed-item').find((r) => within(r).queryByTestId('feed-who')?.textContent === who && r.textContent?.includes('changed'))!
  const leadRow = rowOf('Team Lead')
  expect(within(leadRow).getByTestId('feed-role')).toHaveTextContent('System Manager')
  const bareRow = rowOf('jo.nameless')
  expect(within(bareRow).queryByTestId('feed-role')).toBeNull()
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
