import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { issueSession } from '../src/auth'

// #101 Phase 3: batched capture of read-side intent into user_event —
// append-only, caller-scoped, clamped timestamps, 90-day retention.

const DAY = 86_400_000

function ev(key: string, at?: number, extra: Record<string, unknown> = {}) {
  return { kind: 'row', key, label: key, path: `/admin/X/${key}`, ...(at ? { at } : {}), ...extra }
}

describe('#101: POST /api/events + GET /api/events/summary', () => {
  test('a batch lands and the summary aggregates per key, oldest-first visits', async ({
    admin,
  }) => {
    const now = Date.now()
    const res = await admin.post<{ inserted: number }>('/api/events', {
      events: [
        ev('row:X/A', now - 60_000),
        ev('row:X/A', now - 1_000, { label: 'A latest' }),
        { kind: 'list', key: 'list:X?', label: 'X', sub: 'status = Open', path: '/admin/X', at: now },
      ],
    })
    expect(res.inserted).toBe(3)

    const summary = await admin.get<{ entries: Array<Record<string, unknown>> }>(
      '/api/events/summary',
    )
    const a = summary.entries.find((e) => e.key === 'row:X/A')
    const l = summary.entries.find((e) => e.key === 'list:X?')
    expect(a).toBeDefined()
    expect(l).toMatchObject({ kind: 'list', sub: 'status = Open' })
    const visits = a!.visits as number[]
    expect(visits).toHaveLength(2)
    expect(visits[0]).toBeLessThan(visits[1])
    // The newest event's label wins the aggregate.
    expect(a!.label).toBe('A latest')
  })

  test('validation: unknown kind, empty batch, oversize batch are all 417', async ({ admin }) => {
    await expect(
      admin.post('/api/events', { events: [{ kind: 'hack', key: 'x' }] }),
    ).rejects.toMatchObject({ status: 417 })
    await expect(admin.post('/api/events', { events: [] })).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.post('/api/events', { events: Array.from({ length: 51 }, (_, i) => ev(`k${i}`)) }),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('the trail is scoped to the caller — another user sees nothing', async ({ admin, api }) => {
    await admin.post('/api/events', { events: [ev('row:X/private')] })
    await admin.post('/api/save_doc', {
      doctype: 'User',
      doc: { row_id: 'events-b@x.com', email: 'events-b@x.com', enabled: true },
    })
    const { token } = await issueSession('events-b@x.com')
    const res = await api.fetch('/api/events/summary', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { entries: unknown[] }
    expect(body.entries).toHaveLength(0)
  })

  test('client timestamps are clamped to the trust window', async ({ admin }) => {
    const now = Date.now()
    await admin.post('/api/events', {
      events: [ev('row:X/old', now - 400 * DAY), ev('row:X/future', now + 5 * DAY)],
    })
    const summary = await admin.get<{ entries: Array<{ key: string; visits: number[] }> }>(
      '/api/events/summary',
    )
    const old = summary.entries.find((e) => e.key === 'row:X/old')!
    const future = summary.entries.find((e) => e.key === 'row:X/future')!
    expect(old.visits[0]).toBeGreaterThanOrEqual(now - 8 * DAY)
    expect(future.visits[0]).toBeLessThanOrEqual(now + 60_000)
  })

  // PR #104 review: the contract allows 400-char keys/labels and 1000-char
  // paths — storage must hold what validation accepts, or one long
  // filtered-list key fails its whole batch.
  test('values at the contract limits are stored intact', async ({ admin }) => {
    const longKey = ('list:X?' + JSON.stringify([['status', '=', 'x'.repeat(360)]])).slice(0, 400)
    const res = await admin.post<{ inserted: number }>('/api/events', {
      events: [
        {
          kind: 'list',
          key: longKey,
          label: 'L'.repeat(400),
          sub: 's'.repeat(400),
          path: '/admin/X?filters=' + 'y'.repeat(980),
        },
      ],
    })
    expect(res.inserted).toBe(1)
    const summary = await admin.get<{ entries: Array<{ key: string; path: string }> }>(
      '/api/events/summary',
    )
    const entry = summary.entries.find((e) => e.key === longKey)!
    expect(entry).toBeDefined()
    expect(entry.path.length).toBeGreaterThan(900)
  })

  test('rows older than the retention window are pruned on the write path', async ({ admin }) => {
    await sql`insert into user_event ${sql({
      row_id: 'evt-ancient',
      created_by: 'Administrator',
      updated_by: 'Administrator',
      created_at: new Date(),
      updated_at: new Date(),
      status: 'draft',
      kind: 'row',
      ref_key: 'row:X/ancient',
      label: 'ancient',
      path: '/admin/X/ancient',
      occurred_at: new Date(Date.now() - 100 * DAY),
    })}`
    // A dormant user's expired trail goes too — retention is global, not
    // per-poster (PR #104 review).
    await sql`insert into user_event ${sql({
      row_id: 'evt-dormant',
      created_by: 'dormant@x.com',
      updated_by: 'dormant@x.com',
      created_at: new Date(),
      updated_at: new Date(),
      status: 'draft',
      kind: 'row',
      ref_key: 'row:X/dormant',
      label: 'dormant',
      path: '/admin/X/dormant',
      occurred_at: new Date(Date.now() - 120 * DAY),
    })}`
    await admin.post('/api/events', { events: [ev('row:X/fresh')] })
    const summary = await admin.get<{ entries: Array<{ key: string }> }>('/api/events/summary')
    expect(summary.entries.some((e) => e.key === 'row:X/fresh')).toBe(true)
    expect(summary.entries.some((e) => e.key === 'row:X/ancient')).toBe(false)
    const [dormant] = await sql`select 1 from user_event where row_id = 'evt-dormant'`
    expect(dormant).toBeUndefined()
  })
})
