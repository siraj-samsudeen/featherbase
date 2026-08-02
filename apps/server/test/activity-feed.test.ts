import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { issueSession } from '../src/auth'
import { logActivity } from '../src/audit'

// #101 Phase 4: /api/activity_feed — 'mine' is the caller's raw trail;
// 'team' shows changes + logins only and requires System Manager.

describe('#101: GET /api/activity_feed', () => {
  test("'mine' returns the caller's trail newest-first", async ({ admin }) => {
    const now = Date.now()
    await admin.post('/api/events', {
      events: [
        { kind: 'row', key: 'row:X/A', label: 'A', path: '/admin/X/A', at: now - 60_000 },
        { kind: 'search', key: 'search:acme', label: 'acme', at: now },
      ],
    })
    const feed = await admin.get<{ items: Array<Record<string, unknown>> }>(
      '/api/activity_feed?scope=mine',
    )
    expect(feed.items.length).toBeGreaterThanOrEqual(2)
    expect(feed.items[0]).toMatchObject({ kind: 'search', label: 'acme', who: 'Administrator' })
    expect(feed.items[1]).toMatchObject({ kind: 'row', label: 'A' })
  })

  test("'team' carries changes (Version) and logins, never read events", async ({ admin }) => {
    // A tracked edit writes a Version row (track_changes is the default).
    await admin.post('/api/doctype', {
      name: 'Feed DT',
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
    })
    const created = await admin.post<{ updated_at: string }>('/api/save_doc', {
      doctype: 'Feed DT',
      doc: { name: 'feed-row', title: 'v1' },
    })
    await admin.post('/api/save_doc', {
      doctype: 'Feed DT',
      doc: { name: 'feed-row', title: 'v2', updated_at: created.updated_at },
    })
    await logActivity('Administrator', 'login', { full_name: 'Administrator' })
    // A read event that must NOT surface in the team scope.
    await admin.post('/api/events', {
      events: [{ kind: 'row', key: 'row:Feed DT/feed-row', label: 'feed-row' }],
    })

    const feed = await admin.get<{ items: Array<Record<string, unknown>> }>(
      '/api/activity_feed?scope=team',
    )
    const change = feed.items.find((i) => i.kind === 'change' && i.label === 'feed-row')
    expect(change).toMatchObject({ sub: 'Feed DT', path: '/admin/Feed DT/feed-row' })
    expect(feed.items.some((i) => i.kind === 'login')).toBe(true)
    expect(feed.items.every((i) => !['row', 'list', 'page', 'search'].includes(i.kind as string))).toBe(
      true,
    )
  })

  test("'team' is refused without System Manager", async ({ admin, api }) => {
    await admin.post('/api/save_doc', {
      doctype: 'User',
      doc: { name: 'feed-user@x.com', email: 'feed-user@x.com', enabled: true },
    })
    const { token } = await issueSession('feed-user@x.com')
    const res = await api.fetch('/api/activity_feed?scope=team', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(403)
    // Their own 'mine' scope still works.
    const mine = await api.fetch('/api/activity_feed?scope=mine', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(mine.status).toBe(200)
  })
})
