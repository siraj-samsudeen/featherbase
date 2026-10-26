import { ADMIN_NAMED_PAGE_KINDS, ADMIN_STATIC_PAGES, ADMIN_UNRECORDED_ROOTS } from 'shared'
import { routeTree } from '../src/router'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  actionForLocation,
  ago,
  connectEventSink,
  describeFilters,
  displayEntry,
  uniqueByDisplay,
  flushPendingEvents,
  frecency,
  frequentActions,
  recentActions,
  recentSearches,
  recordAction,
} from '../src/lib/recents'

// #101 Phase 1: the client-side recents buffer behind the command bar.

const USER = 'Administrator'
const DAY = 86_400_000
const NOW = 1_800_000_000_000

const row = (name: string) => ({
  kind: 'row' as const,
  key: `row:Customer/${name}`,
  label: name,
  sub: 'Customer',
  path: `/featherbase/admin/Customer/${name}`,
})

beforeEach(() => localStorage.clear())

describe('recordAction / recentActions', () => {
  it('orders newest first and revisiting bumps instead of duplicating', () => {
    recordAction(USER, row('CUST-1'), NOW - 3000)
    recordAction(USER, row('CUST-2'), NOW - 2000)
    recordAction(USER, row('CUST-1'), NOW - 1000)
    const recents = recentActions(USER, 10)
    expect(recents.map((r) => r.label)).toEqual(['CUST-1', 'CUST-2'])
    expect(recents[0].visits).toHaveLength(2)
  })

  it('keeps buffers per user', () => {
    recordAction(USER, row('CUST-1'), NOW)
    expect(recentActions('someone-else', 10)).toEqual([])
  })

  it('caps the buffer by dropping the least-recent entries', () => {
    for (let i = 0; i < 90; i++) recordAction(USER, row(`CUST-${i}`), NOW - (90 - i) * 1000)
    const recents = recentActions(USER, 100)
    expect(recents).toHaveLength(80)
    expect(recents[0].label).toBe('CUST-89')
    expect(recents.some((r) => r.label === 'CUST-0')).toBe(false)
  })
})

describe('frecency / frequentActions', () => {
  it('weights visits by age bucket', () => {
    const entry = { ...row('CUST-1'), visits: [NOW - DAY, NOW - 20 * DAY, NOW - 100 * DAY] }
    expect(frecency(entry, NOW)).toBe(100 + 50 + 10)
  })

  it('needs 2+ visits, excludes searches, and ranks repeat targets first', () => {
    recordAction(USER, row('CUST-once'), NOW - DAY)
    for (const at of [NOW - 2 * DAY, NOW - DAY, NOW - 1000]) recordAction(USER, row('CUST-daily'), at)
    for (const at of [NOW - 80 * DAY, NOW - 70 * DAY]) recordAction(USER, row('CUST-stale'), at)
    recordAction(USER, { kind: 'search', key: 'search:x', label: 'x', path: '' }, NOW - 2000)
    recordAction(USER, { kind: 'search', key: 'search:x', label: 'x', path: '' }, NOW - 1000)
    const frequent = frequentActions(USER, 10, NOW)
    expect(frequent.map((f) => f.label)).toEqual(['CUST-daily', 'CUST-stale'])
  })
})

describe('recentSearches', () => {
  it('matches a prefix and never offers the exact text already typed', () => {
    recordAction(USER, { kind: 'search', key: 'search:overdue chennai', label: 'overdue chennai', path: '' }, NOW - 2000)
    recordAction(USER, { kind: 'search', key: 'search:meenakshi', label: 'meenakshi', path: '' }, NOW - 1000)
    expect(recentSearches(USER, 'over', 5).map((s) => s.label)).toEqual(['overdue chennai'])
    expect(recentSearches(USER, 'overdue chennai', 5)).toEqual([])
    expect(recentSearches(USER, '', 5).map((s) => s.label)).toEqual(['meenakshi', 'overdue chennai'])
  })
})

describe('actionForLocation', () => {
  it('maps a form URL to a row action', () => {
    expect(actionForLocation('/featherbase/admin/Customer/CUST-7', {})).toMatchObject({
      kind: 'row',
      key: 'row:Customer/CUST-7',
      label: 'CUST-7',
      sub: 'Customer',
      path: '/featherbase/admin/Customer/CUST-7',
    })
  })

  it('maps a filtered list URL to a list action that keeps the filters', () => {
    const filters = '[["status","=","Open"]]'
    const action = actionForLocation('/featherbase/admin/Task', { filters })
    expect(action).toMatchObject({ kind: 'list', label: 'Task', sub: 'status = Open' })
    expect(action?.path).toBe(`/featherbase/admin/Task?filters=${encodeURIComponent(filters)}`)
    // A different filter set is a different remembered view.
    expect(action?.key).not.toBe(actionForLocation('/featherbase/admin/Task', {})?.key)
  })

  it('treats list view modes as lists and reports/dashboards as pages', () => {
    expect(actionForLocation('/featherbase/admin/Task/view/kanban', {})).toMatchObject({ kind: 'list', sub: 'kanban' })
    expect(actionForLocation('/featherbase/admin/script-report/Sales%20Register', {})).toMatchObject({
      kind: 'page',
      label: 'Sales Register',
      sub: 'Report',
    })
    expect(actionForLocation('/featherbase/admin/dashboard/Ops', {})).toMatchObject({ kind: 'page', sub: 'Dashboard' })
  })

  it('ignores home pages, builders, and transient new forms', () => {
    expect(actionForLocation('/featherbase/admin', {})).toBeNull()
    expect(actionForLocation('/featherbase/admin/home/home', {})).toBeNull()
    expect(actionForLocation('/featherbase/admin/new-table', {})).toBeNull()
    expect(actionForLocation('/featherbase/admin/import', {})).toBeNull()
    expect(actionForLocation('/featherbase/admin/Customer/new', {})).toBeNull()
    // #440: the browser and the jobs monitor are not Tables named "source" / "jobs".
    expect(actionForLocation('/featherbase/admin/source/Warehouse', {})).toBeNull()
    expect(actionForLocation('/featherbase/admin/jobs', {})).toBeNull()
  })

  it('#440: a static admin page is remembered as a page under its title', () => {
    expect(actionForLocation('/featherbase/admin/access-tokens', {})).toMatchObject({
      kind: 'page',
      key: 'page:access-tokens',
      label: 'Access tokens',
      path: '/featherbase/admin/access-tokens',
    })
  })

  it('#440: every static admin page in the router is catalogued or deliberately unrecorded', () => {
    const admin = (routeTree.children as unknown as Array<{ options: { path?: string }; children?: unknown }>).find(
      (r) => r.options.path === '/featherbase/admin',
    )!
    const kids = Object.values(admin.children as object) as Array<{ options: { path?: string } }>
    const roots = new Set(
      kids
        .map((k) => (k.options.path ?? '/').split('/')[0])
        .filter((seg) => seg && !seg.startsWith('$')),
    )
    expect(roots.size).toBeGreaterThan(10) // positive control: the walk found the routes
    const known = new Set<string>([
      ...ADMIN_STATIC_PAGES.map((p) => p.slug),
      ...ADMIN_UNRECORDED_ROOTS,
      ...Object.keys(ADMIN_NAMED_PAGE_KINDS),
    ])
    expect([...roots].filter((r) => !known.has(r))).toEqual([])
  })
})

// PR #104 review: the debounce queue is owner-tagged and fail-closed — a
// pending batch never rides another account's session.
describe('server event queue attribution', () => {
  function sinkFor(current: string | null, posted: Array<Record<string, unknown>>) {
    connectEventSink({
      currentUser: () => current,
      post: (events) => posted.push(...events),
      beacon: (events) => posted.push(...events),
    })
  }

  beforeEach(() => {
    // Drain whatever an earlier test queued: with no authenticated user,
    // everything is discarded.
    sinkFor(null, [])
    flushPendingEvents()
  })

  it("another account's pending events are discarded, never re-attributed", () => {
    const posted: Array<Record<string, unknown>> = []
    recordAction('user-a', row('CUST-1'), NOW)
    sinkFor('user-b', posted)
    flushPendingEvents()
    expect(posted).toHaveLength(0)
    // The discard is permanent — they do not resurface for their owner later.
    sinkFor('user-a', posted)
    flushPendingEvents()
    expect(posted).toHaveLength(0)
  })

  it("the owner's events flush under their own session", () => {
    const posted: Array<Record<string, unknown>> = []
    sinkFor('user-a', posted)
    recordAction('user-a', row('CUST-2'), NOW)
    flushPendingEvents()
    expect(posted.map((p) => p.key)).toEqual(['row:Customer/CUST-2'])
  })

  it('a mixed queue only ships the current session’s share', () => {
    const posted: Array<Record<string, unknown>> = []
    sinkFor('user-a', posted)
    recordAction('user-a', row('CUST-3'), NOW - 1000)
    recordAction('user-b', row('CUST-4'), NOW)
    flushPendingEvents()
    expect(posted.map((p) => p.key)).toEqual(['row:Customer/CUST-3'])
  })
})

describe('helpers', () => {
  it('describeFilters renders a readable summary and survives junk', () => {
    expect(describeFilters('[["status","=","Open"],["region","=","South"]]')).toBe(
      'status = Open · region = South',
    )
    expect(describeFilters('not json')).toBeUndefined()
    expect(describeFilters(undefined)).toBeUndefined()
  })

  it('ago compresses to m/h/d', () => {
    expect(ago(NOW - 30_000, NOW)).toBe('now')
    expect(ago(NOW - 5 * 60_000, NOW)).toBe('5m')
    expect(ago(NOW - 3 * 3_600_000, NOW)).toBe('3h')
    expect(ago(NOW - 2 * DAY, NOW)).toBe('2d')
  })
})

// Home cleanup: decided at render time, so entries recorded before a rule
// existed read the same as new ones.
describe('displayEntry', () => {
  it('reads an old slug-labelled page as its catalog title', () => {
    expect(displayEntry({ kind: 'list', key: 'list:explore?', label: 'explore', path: '/featherbase/admin/explore' }))
      .toEqual({ kind: 'page', label: 'Explore' })
  })
  it('reads a row by reference, with its Table as the sub-line', () => {
    expect(displayEntry(row('1517|040802006'))).toEqual({
      kind: 'row', label: '1517|040802006', sub: 'Customer', row: { table: 'Customer', rowId: '1517|040802006' },
    })
  })
  it('takes the kind from the key when a pinned target carries none', () => {
    expect(displayEntry({ key: 'page:explore', label: 'explore', path: '/featherbase/admin/explore' }).label).toBe('Explore')
    expect(displayEntry({ key: 'list:Task?', label: 'Task', sub: 'kanban', path: '/featherbase/admin/Task' }))
      .toEqual({ kind: 'list', label: 'Task', sub: 'kanban' })
  })
})

describe('uniqueByDisplay', () => {
  it('folds an old slug entry and a new page entry for the same page into one', () => {
    const old = { kind: 'list' as const, key: 'list:explore?', label: 'explore', path: '/featherbase/admin/explore', visits: [1] }
    const now = { kind: 'page' as const, key: 'page:explore', label: 'Cross-filter workspace', path: '/featherbase/admin/explore', visits: [2] }
    expect(uniqueByDisplay([now, old]).map((e) => e.key)).toEqual(['page:explore'])
    expect(uniqueByDisplay([{ ...row('A'), visits: [1] }, { ...row('B'), visits: [1] }])).toHaveLength(2)
  })
})
