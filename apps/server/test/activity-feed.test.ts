import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { issueSession } from '../src/auth'
import { logActivity } from '../src/audit'
import { sql } from '../src/db'

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
    expect(feed.items[0]).toMatchObject({ kind: 'search', label: 'acme', who_name: 'Administrator' })
    expect(feed.items[1]).toMatchObject({ kind: 'row', label: 'A' })
  })

  test("'team' carries changes (Version) and logins, never read events", async ({ admin }) => {
    // A tracked edit writes a Version row (track_changes is the default).
    await admin.post('/api/table_def', {
      name: 'Feed DT',
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
    })
    const created = await admin.post<{ updated_at: string }>('/api/save_row', {
      table: 'Feed DT',
      row: { row_id: 'feed-row', title: 'v1' },
    })
    await admin.post('/api/save_row', {
      table: 'Feed DT',
      row: { row_id: 'feed-row', title: 'v2', updated_at: created.updated_at },
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
    expect(change).toMatchObject({ sub: 'Feed DT', path: '/featherbase/admin/Feed DT/feed-row' })
    expect(feed.items.some((i) => i.kind === 'login')).toBe(true)
    expect(feed.items.every((i) => !['row', 'list', 'page', 'search'].includes(i.kind as string))).toBe(
      true,
    )
  })

  test("'team' is refused without System Manager", async ({ admin, api }) => {
    const person = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email: 'feed-user@x.com', enabled: true },
    })
    const { token } = await issueSession(person.row_id)
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

  // #440: the feed names people, not ids.
  test('items carry the display name, not just the opaque person id', async ({ admin, api }) => {
    const person = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email: 'feed-named@x.com', full_name: 'Feed Tester', enabled: true },
    })
    const { token } = await issueSession(person.row_id)
    await api.fetch('/api/events', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ kind: 'search', key: 'search:named', label: 'named' }] }),
    })
    const res = await api.fetch('/api/activity_feed?scope=mine', {
      headers: { authorization: `Bearer ${token}` },
    })
    const mine = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(mine.items[0]).toMatchObject({ who_name: 'Feed Tester' })
    expect(mine.items[0]).not.toHaveProperty('who')
    expect(JSON.stringify(mine)).not.toContain(person.row_id)

    // The team scope names the editor too, not their id.
    await admin.post('/api/table_def', {
      name: 'Feed Named DT',
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
    })
    const created = await admin.post<{ updated_at: string }>('/api/save_row', {
      table: 'Feed Named DT',
      row: { row_id: 'named-row', title: 'v1' },
    })
    await admin.post('/api/save_row', {
      table: 'Feed Named DT',
      row: { row_id: 'named-row', title: 'v2', updated_at: created.updated_at },
    })
    const team = await admin.get<{ items: Array<Record<string, unknown>> }>(
      '/api/activity_feed?scope=team',
    )
    const change = team.items.find((i) => i.kind === 'change' && i.label === 'named-row')
    expect(change).toMatchObject({ who_name: 'Administrator' })
  })

  test("a list open says whether a filter was actually applied", async ({ admin }) => {
    const now = Date.now()
    const filters = JSON.stringify([['status', '=', 'Overdue']])
    await admin.post('/api/events', {
      events: [
        { kind: 'list', key: 'list:Task?', label: 'Task', path: '/featherbase/admin/Task', at: now - 4000 },
        { kind: 'list', key: `list:Task?${filters}`, label: 'Task', sub: 'status = Overdue', at: now - 3000 },
        { kind: 'list', key: 'list:Task/kanban?', label: 'Task', sub: 'kanban', at: now - 2000 },
        { kind: 'list', key: 'list:Task?[]', label: 'Task', at: now - 1000 },
        { kind: 'list', key: 'list:Task?[null]', label: 'Task', at: now - 500 },
        { kind: 'list', key: 'list:Task?{bad', label: 'Task', at: now - 400 },
        { kind: 'list', key: 'list:Task?null', label: 'Task', at: now - 300 },
      ],
    })
    const feed = await admin.get<{ items: Array<Record<string, unknown>> }>(
      '/api/activity_feed?scope=mine',
    )
    const lists = feed.items.filter((i) => i.kind === 'list')
    // newest first: ?null, {bad, [null], [], kanban, valid filter, plain
    expect(lists.map((i) => i.filtered)).toEqual([false, false, false, false, false, true, false])
  })

  test('a fixed admin page shows its page title, not its route slug', async ({ admin }) => {
    await admin.post('/api/events', {
      events: [
        {
          kind: 'list',
          key: 'list:sign-in-methods?',
          label: 'sign-in-methods',
          path: '/featherbase/admin/sign-in-methods',
        },
      ],
    })
    const feed = await admin.get<{ items: Array<Record<string, unknown>> }>(
      '/api/activity_feed?scope=mine',
    )
    expect(feed.items[0]).toMatchObject({ kind: 'page', label: 'Sign-in methods' })
    expect(feed.items[0]).not.toHaveProperty('filtered', true)
  })

  // #440 (Siraj's addition): team rows name the person and their main role.
  test('team rows carry who_name and who_role; a nameless person falls back to the email local part', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: 'Feed Role DT',
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
    })
    const edit = async (as: string, row_id: string) => {
      const c = await admin.post<{ updated_at: string }>('/api/save_row', {
        table: 'Feed Role DT',
        row: { row_id, title: 'v1' },
      })
      await sql`update version set created_by = ${as} where ref_name = ${row_id}`
      return c
    }
    const named = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: {
        email: 'named-mgr@x.com', full_name: 'Role Tester', enabled: true,
        roles: [{ role: 'Data Quality Manager' }, { role: 'System Manager' }],
      },
    })
    const nameless = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email: 'jo.nameless@x.com', enabled: true },
    })
    for (const [pid, rid] of [[named.row_id, 'r-named'], [nameless.row_id, 'r-nameless']]) {
      const c = await edit('Administrator', rid)
      await admin.post('/api/save_row', {
        table: 'Feed Role DT', row: { row_id: rid, title: 'v2', updated_at: c.updated_at },
      })
      await sql`update version set created_by = ${pid} where ref_name = ${rid}`
    }
    const team = await admin.get<{ items: Array<Record<string, unknown>> }>('/api/activity_feed?scope=team')
    const a = team.items.find((i) => i.label === 'r-named')
    const b = team.items.find((i) => i.label === 'r-nameless')
    expect(a).toMatchObject({ who_name: 'Role Tester', who_role: 'System Manager' })
    expect(b).toMatchObject({ who_name: 'jo.nameless' })
    expect(b).not.toHaveProperty('who_role', expect.anything())
    expect(JSON.stringify(team)).not.toContain('@x.com')
  })

  test('a sign-in row names no one twice and shows no opaque id', async ({ admin }) => {
    const pid = (
      await admin.post<{ row_id: string }>('/api/save_row', {
        table: 'Person',
        row: { email: 'login-nameless@x.com', enabled: true },
      })
    ).row_id
    await logActivity(pid, 'login', { full_name: null })
    const team = await admin.get<{ items: Array<Record<string, unknown>> }>('/api/activity_feed?scope=team')
    const login = team.items.find((i) => i.kind === 'login' && i.who_name === 'login-nameless')
    expect(login).toBeTruthy()
    expect(login!.label).toBe('')
    expect(JSON.stringify(login)).not.toContain('psn_')
  })

  test('an edit made with a service-account token shows its label, never the svc_ id', async ({ admin, api }) => {
    const svc = await admin.post<{ row_id: string }>('/api/service_accounts', {
      label: 'svc-nightly-importer',
      roles: ['System Manager'],
    })
    const { token } = await admin.post<{ token: string }>('/api/access_tokens', {
      label: 'feed token',
      owner: svc.row_id,
    })
    await admin.post('/api/table_def', {
      name: 'Feed Svc DT',
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
    })
    const asSvc = async (row: Record<string, unknown>) => {
      const res = await api.fetch('/api/save_row', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ table: 'Feed Svc DT', row }),
      })
      expect(res.ok).toBe(true)
      return (await res.json()) as { updated_at: string }
    }
    const created = await asSvc({ row_id: 'svc-row', title: 'v1' })
    await asSvc({ row_id: 'svc-row', title: 'v2', updated_at: created.updated_at })
    const team = await admin.get<{ items: Array<Record<string, unknown>> }>('/api/activity_feed?scope=team')
    const change = team.items.find((i) => i.kind === 'change' && i.label === 'svc-row')
    expect(change).toMatchObject({ who_name: 'svc-nightly-importer', who_role: 'Service account' })
    expect(String(change!.who_name)).not.toContain('svc_')
  })

  // Home cleanup: a run of the same action on the same target is ONE row,
  // collapsed before the limit so a page never fills with repeats.
  test("'mine' collapses consecutive repeats into one row with a count and the latest time", async ({ admin }) => {
    const now = Date.now()
    const explore = { kind: 'page', key: 'page:explore', label: 'Cross-filter workspace', path: '/featherbase/admin/explore' }
    await admin.post('/api/events', {
      events: [
        { ...explore, at: now - 5000 },
        { kind: 'search', key: 'search:acme', label: 'acme', at: now - 4000 },
        { ...explore, at: now - 3000 },
        { ...explore, at: now - 2000 },
        { kind: 'list', key: 'list:Task?', label: 'Task', path: '/featherbase/admin/Task', at: now - 1000 },
      ],
    })
    const feed = await admin.get<{ items: Array<Record<string, unknown>> }>('/api/activity_feed?scope=mine&limit=3')
    expect(feed.items.map((i) => [i.label, i.count])).toEqual([
      ['Task', 1],
      ['Cross-filter workspace', 2],
      ['acme', 1],
    ])
    expect(feed.items[1].at).toBe(new Date(now - 2000).toISOString())
  })

  test("'mine' titles an opened row from its values when its Table has no title column", async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: 'Feed Merch Map',
      id_pattern: 'prompt',
      columns: ['store_code', 'material_group', 'mch_subcategory'].map((column_name) => ({ column_name, column_type: 'Data' })),
    })
    await admin.post('/api/save_row', {
      table: 'Feed Merch Map',
      row: { row_id: '1517|040802006', store_code: '1517', material_group: '040802006', mch_subcategory: 'Kurti Z' },
    })
    await admin.post('/api/events', {
      events: [{ kind: 'row', key: 'row:Feed Merch Map/1517|040802006', label: '1517|040802006', sub: 'Feed Merch Map', path: '/featherbase/admin/Feed%20Merch%20Map/1517%7C040802006' }],
    })
    const feed = await admin.get<{ items: Array<Record<string, unknown>> }>('/api/activity_feed?scope=mine')
    expect(feed.items[0]).toMatchObject({ kind: 'row', title: '1517 · Kurti Z', sub: 'Feed Merch Map' })
  })

  test("'mine' titles an old slug-labelled page from the catalog, query string and all", async ({ admin }) => {
    await admin.post('/api/events', {
      events: [{ kind: 'list', key: 'list:explore?', label: 'explore', path: '/featherbase/admin/explore?root=Task' }],
    })
    const feed = await admin.get<{ items: Array<Record<string, unknown>> }>('/api/activity_feed?scope=mine')
    expect(feed.items[0]).toMatchObject({ kind: 'page', label: 'Cross-filter workspace' })
  })

  test("'team' collapses one person's repeated edits of one row, and keeps distinct rows apart", async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: 'Feed Repeat DT',
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
    })
    let c = await admin.post<{ updated_at: string }>('/api/save_row', { table: 'Feed Repeat DT', row: { row_id: 'rep-a', title: 'v1' } })
    for (const t of ['v2', 'v3'])
      c = await admin.post<{ updated_at: string }>('/api/save_row', { table: 'Feed Repeat DT', row: { row_id: 'rep-a', title: t, updated_at: c.updated_at } })
    const b = await admin.post<{ updated_at: string }>('/api/save_row', { table: 'Feed Repeat DT', row: { row_id: 'rep-b', title: 'v1' } })
    await admin.post('/api/save_row', { table: 'Feed Repeat DT', row: { row_id: 'rep-b', title: 'v2', updated_at: b.updated_at } })
    const team = await admin.get<{ items: Array<Record<string, unknown>> }>('/api/activity_feed?scope=team')
    const rows = team.items.filter((i) => i.kind === 'change' && i.sub === 'Feed Repeat DT')
    expect(rows.map((i) => i.label)).toEqual(['rep-b', 'rep-a'])
    const versions = (n: unknown) => Number(n)
    expect(versions(rows[0].count)).toBeGreaterThanOrEqual(1)
    expect(versions(rows[1].count)).toBeGreaterThanOrEqual(2)
  })

  test('a sign-in by someone no longer on record reads "Unnamed person", never the opaque id', async ({ admin }) => {
    await logActivity('psn_goneaaaaaaaaaaaaaaaa', 'login', { full_name: null })
    const team = await admin.get<{ items: Array<Record<string, unknown>> }>('/api/activity_feed?scope=team')
    expect(JSON.stringify(team)).not.toContain('psn_gone')
    expect(team.items.some((i) => i.kind === 'login' && i.who_name === 'Unnamed person')).toBe(true)
  })
})
