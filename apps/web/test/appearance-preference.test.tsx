import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { api, clearSession, setSession } from '../src/lib/api'
import { followDevice, useTheme } from '../src/lib/theme'

// The theme preference's write queue (#380: the theme is the one appearance
// preference). jsdom has no matchMedia, so `device` paints light here; the
// choice itself is read from the hook and the per-person mirror.

afterEach(() => {
  vi.restoreAllMocks()
  clearSession()
  followDevice()
})

function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function mount(cached = true) {
  setSession('test-token', { row_id: 'Appearance A', email: 'a@example.test', full_name: null })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  if (cached) qc.setQueryData(['whoami'], { theme: 'light' })
  const hook = renderHook(() => useTheme(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  })
  return { ...hook, qc }
}

test('a slow older success cannot snap the latest choice back, but a latest failure rolls back to the older one', async () => {
  const first = deferred(), second = deferred()
  const post = vi.spyOn(api, 'post').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  const { result, qc } = mount()
  act(() => { result.current.set('dark'); result.current.set('device') })
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  expect(post).toHaveBeenNthCalledWith(1, '/api/set_theme', { theme: 'dark' })
  expect(result.current.theme).toBe('device')
  await act(async () => first.resolve({}))
  expect(post).toHaveBeenCalledTimes(2)
  expect(post).toHaveBeenNthCalledWith(2, '/api/set_theme', { theme: 'device' })
  expect(result.current.theme).toBe('device')
  expect(localStorage.getItem('fc_theme:Appearance A')).toBe('device')
  await act(async () => second.reject(new Error('refused')))
  await waitFor(() => expect(result.current.theme).toBe('dark'))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem('fc_theme:Appearance A')).toBe('dark')
  expect(qc.getQueryData(['whoami'])).toMatchObject({ theme: 'dark' })
})

test('an older failure does not erase a later successful choice or poison the queue', async () => {
  const first = deferred(), second = deferred()
  const post = vi.spyOn(api, 'post').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  const { result, qc } = mount()
  act(() => { result.current.set('dark'); result.current.set('device') })
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  await act(async () => first.reject(new Error('first refused')))
  expect(post).toHaveBeenCalledTimes(2)
  expect(result.current.theme).toBe('device')
  await act(async () => second.resolve({}))
  expect(qc.getQueryData(['whoami'])).toMatchObject({ theme: 'device' })
  expect(localStorage.getItem('fc_theme:Appearance A')).toBe('device')
})

test('a failed write restores the server value rather than leaving its optimistic mirror', async () => {
  vi.spyOn(api, 'post').mockRejectedValue(new Error('refused'))
  const { result, qc } = mount()
  act(() => result.current.set('dark'))
  await waitFor(() => expect(result.current.theme).toBe('light'))
  expect(localStorage.getItem('fc_theme:Appearance A')).toBe('light')
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(qc.getQueryData(['whoami'])).toMatchObject({ theme: 'light' })
})

test('unmount and account switch prevent pending completion or queued choices reaching the next account', async () => {
  const first = deferred()
  const post = vi.spyOn(api, 'post').mockImplementation(() => first.promise)
  const { result, qc, unmount } = mount()
  act(() => { result.current.set('dark'); result.current.set('device') })
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  unmount()
  setSession('next-token', { row_id: 'Appearance B', email: 'b@example.test', full_name: null })
  document.documentElement.dataset.theme = 'light'
  await act(async () => first.resolve({}))
  expect(post).toHaveBeenCalledTimes(1)
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem('fc_theme:Appearance B')).toBeNull()
  expect(qc.getQueryData(['whoami'])).toMatchObject({ theme: 'light' })
})

test('a click before whoami resolves rolls back to the server confirmation, not the stale mirror', async () => {
  const identity = deferred(), write = deferred()
  vi.spyOn(api, 'get').mockImplementation(() => identity.promise)
  const post = vi.spyOn(api, 'post').mockImplementation(() => write.promise)
  const { result, qc } = mount(false)
  act(() => result.current.set('device'))
  expect(result.current.theme).toBe('device')
  expect(post).not.toHaveBeenCalled()
  await act(async () => identity.resolve({ theme: 'dark' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  expect(result.current.theme).toBe('device')
  await act(async () => write.reject(new Error('refused')))
  await waitFor(() => expect(result.current.theme).toBe('dark'))
  expect(localStorage.getItem('fc_theme:Appearance A')).toBe('dark')
  expect(qc.getQueryData(['whoami'])).toMatchObject({ theme: 'dark' })
})
