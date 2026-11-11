import { ADMIN_NAMED_PAGE_KINDS, ADMIN_STATIC_PAGES, ADMIN_UNRECORDED_ROOTS } from 'shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSession, getSessionUser, setSession } from '../src/lib/api'
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
  replaceServerEntries,
  recentActions,
  recentSearches,
  recordAction,
  renameTableInRecents,
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
  path: `/featherbase/admin/table/customer/row/${name}`,
})

beforeEach(() => localStorage.clear())

describe('recordAction / recentActions', () => {
  it('clears cached destinations when the server history is empty', () => {
    localStorage.setItem(`fc-recents:${USER}`, JSON.stringify([{ ...row('STALE'), visits: [NOW] }]))
    replaceServerEntries(USER, [])
    expect(recentActions(USER, 10)).toEqual([])
  })

  it('skips unknown kinds and missing identities in a server merge without losing valid destinations', () => {
    recordAction(USER, row('LOCAL'), NOW)
    replaceServerEntries(USER, [
      { ...row('UNKNOWN'), kind: 'future-kind', visits: [NOW + 1] },
      { ...row('NO-KEY'), key: '', visits: [NOW + 2] },
      { ...row('REMOTE'), visits: [NOW + 3] },
    ])
    expect(recentActions(USER, 10)).toEqual([
      { ...row('REMOTE'), visits: [NOW + 3] },
      { ...row('LOCAL'), visits: [NOW] },
    ])
  })

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

  it('one destination the server lists twice is merged, its visits once each in time order', () => {
    replaceServerEntries(USER, [
      { ...row('TWICE'), visits: [NOW + 3, NOW + 1] },
      { ...row('TWICE'), visits: [NOW + 2, NOW + 1] },
    ])
    expect(recentActions(USER, 10).filter((e) => e.label === 'TWICE')).toEqual([{ ...row('TWICE'), visits: [NOW + 1, NOW + 2, NOW + 3] }])
  })

  it('a server history longer than the buffer keeps its most recent destinations', () => {
    replaceServerEntries(USER, Array.from({ length: 90 }, (_, i) => ({ ...row(`SRV-${i}`), visits: [NOW + i] })))
    const recents = recentActions(USER, 100)
    expect(recents).toHaveLength(80)
    expect(recents[0].label).toBe('SRV-89')
    expect(recents.some((r) => r.label === 'SRV-9')).toBe(false)
  })

  it('caps the buffer by dropping the least-recent entries', () => {
    for (let i = 0; i < 90; i++) recordAction(USER, row(`CUST-${i}`), NOW - (90 - i) * 1000)
    const recents = recentActions(USER, 100)
    expect(recents).toHaveLength(80)
    expect(recents[0].label).toBe('CUST-89')
    expect(recents.some((r) => r.label === 'CUST-0')).toBe(false)
  })
})

describe('a Table renamed for one person', () => {
  it("leaves another person's events waiting to be sent as they were", () => {
    const sent: unknown[] = []
    connectEventSink({ currentUser: () => 'rename-other', post: (events) => { sent.push(...events) }, beacon: () => {} })
    recordAction('rename-other', row('C-1'), NOW)
    renameTableInRecents('rename-nobody', 'Customer', 'Client', '/featherbase/admin/table/customer', '/featherbase/admin/table/client')
    flushPendingEvents()
    expect(sent).toEqual([expect.objectContaining({ key: 'row:Customer/C-1' })])
  })
})

describe('a server entry with no label', () => {
  it('is named by its key', () => {
    replaceServerEntries('history-unlabelled', [{ ...row('Q-1'), label: '', visits: [NOW] }])
    expect(recentActions('history-unlabelled', 10).map((e) => e.label)).toEqual(['row:Customer/Q-1'])
  })
})

describe('authoritative history during delivery', () => {
  it.each(['before', 'after'] as const)('does not count a clock-skewed visit twice when its summary arrives %s acknowledgement', (timing) => {
    const owner = `history-skew-${timing}`
    let acknowledge: ((timestamps: number[]) => void) | undefined
    connectEventSink({
      currentUser: () => owner,
      post: (_events, recorded?: (timestamps: number[]) => void) => { acknowledge = recorded },
      beacon: () => {},
    })
    recordAction(owner, row('NEW'), NOW + 60_000)
    flushPendingEvents()
    if (timing === 'after') acknowledge?.([NOW])
    replaceServerEntries(owner, [{ ...row('NEW'), visits: [NOW] }])
    if (timing === 'before') acknowledge?.([NOW])
    expect(recentActions(owner, 10)).toEqual([{ ...row('NEW'), visits: [NOW] }])
    expect(frequentActions(owner, 10, NOW)).toEqual([])
    replaceServerEntries(owner, [])
    expect(recentActions(owner, 10)).toEqual([])
  })

  it.each(['before', 'after', 'failed'] as const)('preserves distinct visits across a stale snapshot when acknowledgement is %s', (timing) => {
    const owner = `history-skew-stale-${timing}`
    let acknowledge!: (timestamps: number[]) => void
    connectEventSink({
      currentUser: () => owner,
      post: (_events, recorded) => { acknowledge = recorded },
      beacon: () => {},
    })
    recordAction(owner, row('NEW'), NOW + 60_000)
    flushPendingEvents()
    recordAction(owner, row('NEW'), NOW + 61_000)
    if (timing === 'before') acknowledge([NOW])
    replaceServerEntries(owner, [{ ...row('NEW'), visits: [NOW - 1000] }])
    if (timing === 'after') acknowledge([NOW])
    const deliveredAt = timing === 'failed' ? NOW + 60_000 : NOW
    expect(recentActions(owner, 10)).toEqual([{ ...row('NEW'), visits: [NOW - 1000, deliveredAt, NOW + 61_000] }])
    expect(frequentActions(owner, 10, NOW)[0].visits).toHaveLength(3)
  })

  it('ignores an acknowledgement from an ended session of the same person', () => {
    const owner = 'history-late-ack'
    let acknowledge!: (timestamps: number[]) => void
    connectEventSink({
      currentUser: () => owner,
      post: (_events, recorded) => { acknowledge = recorded },
      beacon: () => {},
    })
    recordAction(owner, row('NEW'), NOW + 60_000)
    flushPendingEvents()
    clearSession()
    replaceServerEntries(owner, [])
    recordAction(owner, row('NEW'), NOW + 60_000)
    acknowledge([NOW])
    expect(recentActions(owner, 10)).toEqual([{ ...row('NEW'), visits: [NOW + 60_000] }])
  })

  it.each(['queued', 'in-flight', 'failed', 'delivered'] as const)('keeps a %s visit missing from a stale summary', async (delivery) => {
    const owner = `history-${delivery}`
    let finish!: () => void
    const delivered = new Promise<void>((resolve) => { finish = resolve })
    connectEventSink({
      currentUser: () => owner,
      post: () => delivered.then(() => {
        if (delivery === 'failed') throw new Error('offline')
      }).catch(() => {}),
      beacon: () => {},
    })
    localStorage.setItem(`fc-recents:${owner}`, JSON.stringify([{ ...row('STALE'), visits: [NOW - DAY] }]))
    recordAction(owner, row('NEW'), NOW)
    if (delivery !== 'queued') flushPendingEvents()
    if (delivery === 'failed' || delivery === 'delivered') {
      finish()
      await delivered
      await Promise.resolve()
    }
    replaceServerEntries(owner, [{ ...row('SERVER'), visits: [NOW - 1000] }])
    expect(recentActions(owner, 10)).toEqual([
      { ...row('NEW'), visits: [NOW] },
      { ...row('SERVER'), visits: [NOW - 1000] },
    ])
    finish()
  })

  it('folds a retried visit only once when the summary confirms delivery', () => {
    const owner = 'history-retry'
    recordAction(owner, row('NEW'), NOW)
    replaceServerEntries(owner, [])
    expect(recentActions(owner, 10)).toEqual([{ ...row('NEW'), visits: [NOW] }])
    replaceServerEntries(owner, [{ ...row('NEW'), visits: [NOW, NOW] }])
    expect(recentActions(owner, 10)).toEqual([{ ...row('NEW'), visits: [NOW] }])
    // Once confirmed by server history, a later authoritative clear wins.
    replaceServerEntries(owner, [])
    expect(recentActions(owner, 10)).toEqual([])
  })

  it('replaces cached visit counts beneath a new visit to the same destination', () => {
    const owner = 'history-same-key'
    localStorage.setItem(`fc-recents:${owner}`, JSON.stringify([{ ...row('NEW'), visits: [NOW - DAY, NOW - 1000] }]))
    recordAction(owner, row('NEW'), NOW)
    replaceServerEntries(owner, [{ ...row('NEW'), label: 'Server title', visits: [NOW - 1000] }])
    expect(recentActions(owner, 10)).toEqual([{ ...row('NEW'), visits: [NOW - 1000, NOW] }])
  })

  it('discards a departed session journal even after its queue was drained', () => {
    const owner = 'history-departed'
    const person = { row_id: owner, email: null, full_name: null }
    setSession('departing-token', person)
    connectEventSink({ currentUser: () => getSessionUser()?.row_id ?? null, post: () => {}, beacon: () => {} })
    recordAction(owner, row('OLD-SESSION'), NOW)
    // The account menu drains while credentials still exist, then clears
    // the session after successful server sign-out. No signed-out flush runs.
    flushPendingEvents()
    clearSession()
    setSession('returning-token', person)
    replaceServerEntries(owner, [])
    expect(recentActions(owner, 10)).toEqual([])
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
    expect(actionForLocation('/featherbase/admin/table/customer/row/CUST-7', {}, 'Customer')).toMatchObject({
      kind: 'row',
      key: 'row:Customer/CUST-7',
      label: 'CUST-7',
      sub: 'Customer',
      path: '/featherbase/admin/table/customer/row/CUST-7',
    })
  })

  it('maps a filtered list URL to a list action that keeps the filters', () => {
    const filters = '[["status","=","Open"]]'
    const action = actionForLocation('/featherbase/admin/table/task', { filters }, 'Task')
    expect(action).toMatchObject({ kind: 'list', label: 'Task', sub: 'status = Open' })
    expect(action?.path).toBe(`/featherbase/admin/table/task?filters=${encodeURIComponent(filters)}`)
    // A different filter set is a different remembered view.
    expect(action?.key).not.toBe(actionForLocation('/featherbase/admin/table/task', {}, 'Task')?.key)
  })

  it('treats list view modes as lists and reports/dashboards as pages', () => {
    expect(actionForLocation('/featherbase/admin/table/task/view/kanban', {}, 'Task')).toMatchObject({ kind: 'list', sub: 'kanban' })
    expect(actionForLocation('/featherbase/admin/script-report/Sales%20Register', {})).toMatchObject({
      kind: 'page',
      label: 'Sales Register',
      sub: 'Report',
    })
    expect(actionForLocation('/featherbase/admin/dashboard/Ops', {})).toMatchObject({ kind: 'page', sub: 'Dashboard' })
  })

  it('ignores home pages, builders, and transient new forms', () => {
    expect(actionForLocation('/featherbase/admin', {})).toBeNull()
    expect(actionForLocation('/featherbase/admin///', {})).toBeNull()
    expect(actionForLocation('/featherbase/admin/home/home', {})).toBeNull()
    expect(actionForLocation('/featherbase/admin/new-table', {})).toBeNull()
    expect(actionForLocation('/featherbase/admin/import', {})).toBeNull()
    expect(actionForLocation('/featherbase/admin/table/customer/new', {}, 'Customer')).toBeNull()
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

  it('#440: every static admin page in the router is catalogued or deliberately unrecorded', async () => {
    // Load the shell only for this contract: the buffer above also works
    // before a shell has connected its optional server transport.
    const { routeTree } = await import('../src/router')
    const admin = (routeTree.children as unknown as Array<{ options: { path?: string }; children?: unknown }>).find(
      (r) => r.options.path === '/featherbase/admin',
    )!
    const kids = Object.values(admin.children as object) as Array<{ options: { path?: string } }>
    const roots = new Set(
      kids
        .map((k) => (k.options.path ?? '/').split('/')[0])
        // Table destinations now have their own namespace, not a static page.
        .filter((seg) => seg && seg !== 'table' && !seg.startsWith('$')),
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

// More than one batch's worth (50) goes out in batches, the rest after the
// usual pause (merged web coverage, ADR 0012).
describe('a long queue', () => {
  it('ships fifty now and the rest after the pause', async () => {
    vi.useFakeTimers()
    try {
      const posted: Array<Record<string, unknown>> = []
      connectEventSink({ currentUser: () => 'user-a', post: (events) => posted.push(...events), beacon: () => {} })
      for (let i = 0; i < 51; i++) recordAction('user-a', row(`LONG-${i}`), NOW + i)
      flushPendingEvents()
      expect(posted).toHaveLength(50)
      await vi.advanceTimersByTimeAsync(3000)
      expect(posted).toHaveLength(51)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('helpers', () => {
  it('describeFilters renders a readable summary and survives junk', () => {
    expect(describeFilters('[["status","=","Open"],["region","=","South"]]')).toBe(
      'status = Open · region = South',
    )
    expect(describeFilters('not json')).toBeUndefined()
    expect(describeFilters(undefined)).toBeUndefined()
    const columns = [{ column_name: 'policy', label: 'Policy', column_type: 'Choice', choice_labels: { raw_policy: 'Use this policy' } }]
    const filters = '[["policy","=","raw_policy"]]'
    const path = '/featherbase/admin/table/contacts'
    const original = actionForLocation(path, { filters }, 'Contacts')!
    const readable = actionForLocation(path, { filters }, 'Contacts', undefined, columns)!
    expect(readable.sub).toBe('Policy = Use this policy')
    expect(readable.key).toBe(original.key)
    expect(readable.path).toBe(original.path)
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
  it('reads a target with neither a kind nor a kind in its key as a list', () => {
    expect(displayEntry({ key: '', label: 'Bins', path: '/featherbase/admin/table/bin' })).toEqual({ kind: 'list', label: 'Bins' })
  })
  it('takes the kind from the key when a pinned target carries none', () => {
    expect(displayEntry({ key: 'page:explore', label: 'explore', path: '/featherbase/admin/explore' }).label).toBe('Explore')
    expect(displayEntry({ key: 'list:Task?', label: 'Task', sub: 'kanban', path: '/featherbase/admin/table/task' }))
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
