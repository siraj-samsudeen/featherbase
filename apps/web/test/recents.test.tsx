import { beforeEach, describe, expect, it } from 'vitest'
import {
  actionForLocation,
  ago,
  describeFilters,
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
  path: `/admin/Customer/${name}`,
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
    expect(actionForLocation('/admin/Customer/CUST-7', {})).toMatchObject({
      kind: 'row',
      key: 'row:Customer/CUST-7',
      label: 'CUST-7',
      sub: 'Customer',
      path: '/admin/Customer/CUST-7',
    })
  })

  it('maps a filtered list URL to a list action that keeps the filters', () => {
    const filters = '[["status","=","Open"]]'
    const action = actionForLocation('/admin/Task', { filters })
    expect(action).toMatchObject({ kind: 'list', label: 'Task', sub: 'status = Open' })
    expect(action?.path).toBe(`/admin/Task?filters=${encodeURIComponent(filters)}`)
    // A different filter set is a different remembered view.
    expect(action?.key).not.toBe(actionForLocation('/admin/Task', {})?.key)
  })

  it('treats list view modes as lists and reports/dashboards as pages', () => {
    expect(actionForLocation('/admin/Task/view/kanban', {})).toMatchObject({ kind: 'list', sub: 'kanban' })
    expect(actionForLocation('/admin/query-report/Sales%20Register', {})).toMatchObject({
      kind: 'page',
      label: 'Sales Register',
      sub: 'Report',
    })
    expect(actionForLocation('/admin/dashboard/Ops', {})).toMatchObject({ kind: 'page', sub: 'Dashboard' })
  })

  it('ignores home pages, builders, and transient new forms', () => {
    expect(actionForLocation('/admin', {})).toBeNull()
    expect(actionForLocation('/admin/home/home', {})).toBeNull()
    expect(actionForLocation('/admin/new-table', {})).toBeNull()
    expect(actionForLocation('/admin/import', {})).toBeNull()
    expect(actionForLocation('/admin/Customer/new', {})).toBeNull()
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
