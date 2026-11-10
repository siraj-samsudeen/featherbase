// Small helpers whose edges no page reaches on its own: a refusal that is not
// the server's, recently opened with no app shell, across a Table's rename and
// from a kept list that is not one, and the sidebar's
// collapsed choice with nobody signed in.
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { refusalMessage } from '../src/lib/table-refusal'
import { useSidebarCollapsed } from '../src/lib/sidebar-collapsed'
import { flushPendingEvents, recentActions, recordAction, renameTableInRecents } from '../src/lib/recents'

afterEach(() => localStorage.clear())

describe('refusalMessage', () => {
  test('a failure that is not the server’s refusal reads as the fallback', () => {
    expect(refusalMessage(new TypeError('Failed to fetch'), 'The Table could not be saved')).toBe('The Table could not be saved')
  })
})

// No Admin shell is loaded in this file, so no events go to the server.
describe('recently opened, with no app shell to send visits to', () => {
  test('a visit stays in this browser, and sending what is pending sends nothing', () => {
    recordAction('Administrator', { kind: 'list', key: 'list:Shelf?', label: 'Shelf', path: '/featherbase/admin/table/shelf' })
    expect(() => flushPendingEvents()).not.toThrow()
    expect(recentActions('Administrator', 5).map((e) => e.label)).toEqual(['Shelf'])
  })

  test("renaming a Table leaves other Tables' entries as they were", () => {
    recordAction('Administrator', { kind: 'list', key: 'list:Bin?', label: 'Bin', path: '/featherbase/admin/table/bin' })
    recordAction('Administrator', { kind: 'list', key: 'list:Rack?', label: 'Rack', path: '/featherbase/admin/table/rack' })
    renameTableInRecents('Administrator', 'Bin', 'Store Bin', '/featherbase/admin/table/bin', '/featherbase/admin/table/store-bin')
    expect(recentActions('Administrator', 5).map((e) => [e.key, e.path]).sort()).toEqual([
      ['list:Rack?', '/featherbase/admin/table/rack'],
      ['list:Store Bin?', '/featherbase/admin/table/store-bin'],
    ])
  })
})

describe('recently opened, when a Table is renamed', () => {
  test("a row's entry keeps its own title while the Table it names follows the rename", () => {
    recordAction('Administrator', { kind: 'row', key: 'row:Bin/B-1', label: 'Bay one', sub: 'Bin', path: '/featherbase/admin/table/bin/row/B-1' })
    renameTableInRecents('Administrator', 'Bin', 'Store Bin', '/featherbase/admin/table/bin', '/featherbase/admin/table/store-bin')
    expect(recentActions('Administrator', 5)).toMatchObject([
      { key: 'row:Store Bin/B-1', label: 'Bay one', sub: 'Store Bin', path: '/featherbase/admin/table/store-bin/row/B-1' },
    ])
  })

  test("a filtered list's address follows the rename with its filters", () => {
    recordAction('Administrator', { kind: 'list', key: 'list:Bin?open', label: 'Bin', path: '/featherbase/admin/table/bin?filters=open' })
    renameTableInRecents('Administrator', 'Bin', 'Store Bin', '/featherbase/admin/table/bin', '/featherbase/admin/table/store-bin')
    expect(recentActions('Administrator', 5)[0].path).toBe('/featherbase/admin/table/store-bin?filters=open')
  })

  test('an entry for the Table opened at another address keeps that address', () => {
    recordAction('Administrator', { kind: 'list', key: 'list:Bin?', label: 'Bin', path: '/featherbase/app/stores/bins' })
    renameTableInRecents('Administrator', 'Bin', 'Store Bin', '/featherbase/admin/table/bin', '/featherbase/admin/table/store-bin')
    expect(recentActions('Administrator', 5)).toMatchObject([{ key: 'list:Store Bin?', path: '/featherbase/app/stores/bins' }])
  })
})

describe('recently opened, from what this browser kept', () => {
  test('a kept list that is not a list reads as nothing opened', () => {
    localStorage.setItem('fc-recents:Administrator', '{"not":"a list"}')
    expect(recentActions('Administrator', 5)).toEqual([])
  })
})

describe('the sidebar’s collapsed choice', () => {
  test('with nobody signed in it starts open and is kept for the visit only', () => {
    const { result } = renderHook(() => useSidebarCollapsed(undefined))
    expect(result.current[0]).toBe(false)
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
    expect(localStorage.length).toBe(0)
  })
})
