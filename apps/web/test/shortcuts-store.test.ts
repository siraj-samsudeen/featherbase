// #1251: the shortcut list and the learning store, below any screen: a shortcut
// two pages add stays until both leave; leaving the page sends what was
// learnt; and a learning record that cannot be read never blocks the teaching.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { DAY_MS, SHORTCUT_SETTINGS } from 'shared'
import { api, setSession } from '../src/lib/api'
import { COMMAND_SHORTCUT_DEF, SIDEBAR_SHORTCUT_DEF, TIP_MS, addShortcut, flushShortcutLearning, noteShortcutUse, quietTips, resetTips, useShortcutState, useShortcutTeaching } from '../src/lib/shortcuts'
import type { TestClient } from 'feather-testing-postgres'
import { test, expect } from './pg-test'

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('a shortcut two places add stays listed until both have left', () => {
  const listed = () => renderHook(() => useShortcutState()).result.current.shortcuts.map((s) => s.id)
  const first = addShortcut(SIDEBAR_SHORTCUT_DEF)
  const second = addShortcut(SIDEBAR_SHORTCUT_DEF)
  first()
  first() // a second removal by the same owner changes nothing
  expect(listed()).toContain('sidebar')
  second()
  expect(listed()).not.toContain('sidebar')
})

test('leaving the page sends what was learnt at once', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  const page = renderHook(() => {
    useShortcutTeaching()
    return useShortcutState()
  })
  const remove = addShortcut(SIDEBAR_SHORTCUT_DEF)
  // Once the person's learning has arrived, a use is kept in the store.
  await waitFor(() => {
    noteShortcutUse('sidebar', 'key')
    expect(page.result.current.learning.use.sidebar?.keys).toBeGreaterThan(0)
  })
  window.dispatchEvent(new Event('pagehide'))
  await waitFor(async () => {
    const stored = await admin.get<{ settings: { use?: { sidebar?: { keys: number } } } | null }>(`/api/user_settings/${SHORTCUT_SETTINGS}`)
    expect(stored.settings?.use?.sidebar?.keys).toBeGreaterThan(0)
  })
  remove()
  page.unmount()
})

test('learning that cannot be read starts from nothing and still counts uses', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  // A read that fails while the person stays signed in (the server down, the
  // network gone) cannot be produced against the in-process server, so this
  // one read is made to fail. A refused session is no use: it signs out, and
  // a signed-out person is never taught.
  vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('the server is down'))
  const page = renderHook(() => {
    useShortcutTeaching()
    return useShortcutState()
  })
  await waitFor(() => {
    noteShortcutUse('sidebar', 'key')
    expect(page.result.current.learning.use.sidebar?.keys).toBeGreaterThan(0)
  })
  page.unmount()
})

/** The teaching mounted for a signed-in person, once their learning has arrived. */
async function teach(admin: TestClient) {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, { use: {}, quietUntil: 0, quiets: 0, lastTip: 0 })
  const page = renderHook(() => {
    useShortcutTeaching()
    return useShortcutState()
  })
  await waitFor(() => expect(page.result.current.learning).not.toBe(undefined))
  // A key use on another shortcut proves the learning has arrived.
  await waitFor(() => {
    noteShortcutUse('probe', 'key')
    expect(page.result.current.learning.use.probe?.keys).toBeGreaterThan(0)
  })
  return page
}

// Search's tip: the sidebar's key teaches none (the owner, 18-Nov), so search is the example.
test('a tip leaves after ten seconds, or as soon as its key is used', async ({ admin }) => {
  const remove = addShortcut(COMMAND_SHORTCUT_DEF)
  const page = await teach(admin)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: Date.now() })
  act(() => {
    for (let i = 0; i < 3; i++) noteShortcutUse('command', 'mouse')
  })
  expect(page.result.current.tip?.id).toBe('command')
  act(() => vi.advanceTimersByTime(TIP_MS))
  expect(page.result.current.tip).toBeNull()

  // The next tip waits for 6 more; a key use takes a tip down at once.
  vi.setSystemTime(Date.now() + 2 * DAY_MS)
  act(() => {
    for (let i = 0; i < 6; i++) noteShortcutUse('command', 'mouse')
  })
  expect(page.result.current.tip?.id).toBe('command')
  act(() => noteShortcutUse('command', 'key'))
  expect(page.result.current.tip).toBeNull()
  vi.useRealTimers()
  remove()
  page.unmount()
})

test('the quiet notice leaves after five seconds', async ({ admin }) => {
  const page = await teach(admin)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  act(() => quietTips())
  expect(page.result.current.notice).toMatch(/^Tips are quiet until /)
  act(() => vi.advanceTimersByTime(5000))
  expect(page.result.current.notice).toBeNull()
  vi.useRealTimers()
  page.unmount()
})

test('a key used while the learning is still arriving takes back the tip it would have shown', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, { use: {}, quietUntil: 0, quiets: 0, lastTip: 0 })
  const remove = addShortcut(SIDEBAR_SHORTCUT_DEF)
  const page = renderHook(() => {
    useShortcutTeaching()
    return useShortcutState()
  })
  // Before the read answers: three mouse uses (a tip is due), then the key.
  act(() => {
    for (let i = 0; i < 3; i++) noteShortcutUse('sidebar', 'mouse')
  })
  act(() => noteShortcutUse('sidebar', 'key'))
  await waitFor(() => expect(page.result.current.learning.use.sidebar?.keys).toBe(1))
  expect(page.result.current.tip).toBeNull()
  remove()
  page.unmount()
})

test('a signed-out page loads no learning and counts nothing', () => {
  localStorage.clear()
  const page = renderHook(() => {
    useShortcutTeaching()
    return useShortcutState()
  })
  act(() => noteShortcutUse('sidebar', 'key'))
  expect(page.result.current.learning.use.sidebar).toBeUndefined()
  page.unmount()
})

test('a reset made before the learning arrives is not undone by it', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, { use: { sidebar: { keys: 4, mouse: 0, shown: 0, lastKey: Date.now() } }, quietUntil: 0, quiets: 0, lastTip: 0 })
  const page = renderHook(() => {
    useShortcutTeaching()
    return useShortcutState()
  })
  act(() => resetTips()) // before the read answers
  await waitFor(async () => {
    const stored = await admin.get<{ settings: { use?: { sidebar?: unknown } } | null }>(`/api/user_settings/${SHORTCUT_SETTINGS}`)
    expect(stored.settings?.use?.sidebar).toBeUndefined()
  })
  expect(page.result.current.learning.use.sidebar).toBeUndefined()
  page.unmount()
})

test('uses made just before leaving, while the learning is still arriving, are saved', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, { use: {}, quietUntil: 0, quiets: 0, lastTip: 0 })
  const page = renderHook(() => useShortcutTeaching())
  noteShortcutUse('sidebar', 'key')
  page.unmount() // the page closes before the read answers
  await waitFor(async () => {
    const stored = await admin.get<{ settings: { use?: { sidebar?: { keys: number } } } | null }>(`/api/user_settings/${SHORTCUT_SETTINGS}`)
    expect(stored.settings?.use?.sidebar?.keys).toBe(1)
  })
})

test('signing out before the learning arrives saves nothing for anyone', async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  await admin.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, { use: {}, quietUntil: 0, quiets: 0, lastTip: 0 })
  const page = renderHook(() => useShortcutTeaching())
  noteShortcutUse('sidebar', 'key')
  localStorage.clear() // signed out
  page.unmount()
  await flushShortcutLearning()
  const stored = await admin.get<{ settings: { use?: { sidebar?: unknown } } | null }>(`/api/user_settings/${SHORTCUT_SETTINGS}`)
  expect(stored.settings?.use?.sidebar).toBeUndefined()
})
