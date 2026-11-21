// #1385: each shell mount reads the navigation history again; a read a newer one overtook changes nothing.
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

type Answer = { entries: unknown[] }
const pending: { resolve: (a: Answer) => void; reject: (e: unknown) => void }[] = []
vi.mock('../src/lib/api', () => ({
  api: { get: vi.fn(() => new Promise<Answer>((resolve, reject) => pending.push({ resolve, reject }))) },
  getSessionUser: () => null,
}))
const replaced = vi.fn()
vi.mock('../src/lib/recents', () => ({ replaceServerEntries: (...args: unknown[]) => replaced(...args), connectEventSink: vi.fn() }))

const { useNavigationHistory } = await import('../src/lib/navigation-history')

test('a read overtaken by a newer one writes nothing and settles nothing; the newer one does both', async () => {
  const first = renderHook(() => useNavigationHistory('P-1', true))
  expect(first.result.current).toBe(false)
  first.unmount()
  const second = renderHook(() => useNavigationHistory('P-1', true))
  const listener = renderHook(() => useNavigationHistory('P-1'))
  expect(pending).toHaveLength(2)
  await act(async () => { pending[0]!.resolve({ entries: ['old'] }) })
  expect(replaced).not.toHaveBeenCalled()
  expect(second.result.current).toBe(false)
  await act(async () => { pending[1]!.resolve({ entries: ['new'] }) })
  await waitFor(() => expect(second.result.current).toBe(true))
  expect(listener.result.current).toBe(true)
  expect(replaced).toHaveBeenCalledWith('P-1', ['new'])
  // Another person's readiness is not this one's; no person reads nothing.
  expect(renderHook(() => useNavigationHistory('P-2')).result.current).toBe(false)
  expect(renderHook(() => useNavigationHistory(undefined, true)).result.current).toBe(false)
  expect(pending).toHaveLength(2)
})

test('a failed read unlocks the cache as it is', async () => {
  pending.length = 0
  replaced.mockReset()
  const hook = renderHook(() => useNavigationHistory('P-3', true))
  await act(async () => { pending[0]!.reject(new Error('offline')) })
  await waitFor(() => expect(hook.result.current).toBe(true))
  expect(replaced).not.toHaveBeenCalled()
  // A change to the buffer draws the caller again.
  act(() => { window.dispatchEvent(new Event('navigation-history-updated')) })
  expect(hook.result.current).toBe(true)
})
