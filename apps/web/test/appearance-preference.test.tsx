import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { api, clearSession, setSession } from '../src/lib/api'
import { usePalette } from '../src/lib/palette'
import { useTheme } from '../src/lib/theme'

afterEach(() => {
  vi.restoreAllMocks()
  clearSession()
  delete document.documentElement.dataset.palette
  delete document.documentElement.dataset.theme
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
  if (cached) qc.setQueryData(['whoami'], { palette: 'graphite', theme: 'light' })
  const hook = renderHook(() => ({ palette: usePalette(), theme: useTheme() }), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  })
  return { ...hook, qc }
}

test('a slow older palette success cannot snap Indigo back, but latest failure rolls back to Ivory', async () => {
  const first = deferred(), second = deferred()
  const post = vi.spyOn(api, 'post').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  const { result, qc } = mount()
  act(() => { result.current.palette.set('ivory'); result.current.palette.set('indigo') })
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  expect(post).toHaveBeenNthCalledWith(1, '/api/set_palette', { palette: 'ivory' })
  expect(document.documentElement.dataset.palette).toBe('indigo')
  await act(async () => first.resolve({}))
  expect(post).toHaveBeenCalledTimes(2)
  expect(post).toHaveBeenNthCalledWith(2, '/api/set_palette', { palette: 'indigo' })
  expect(result.current.palette.palette).toBe('indigo')
  expect(localStorage.getItem('fc_palette:Appearance A')).toBe('indigo')
  await act(async () => second.reject(new Error('refused')))
  await waitFor(() => expect(result.current.palette.palette).toBe('ivory'))
  expect(document.documentElement.dataset.palette).toBe('ivory')
  expect(localStorage.getItem('fc_palette:Appearance A')).toBe('ivory')
  expect(qc.getQueryData(['whoami'])).toMatchObject({ palette: 'ivory', theme: 'light' })
})

test('an older palette failure does not erase a later successful choice or poison the queue', async () => {
  const first = deferred(), second = deferred()
  const post = vi.spyOn(api, 'post').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  const { result, qc } = mount()
  act(() => { result.current.palette.set('ivory'); result.current.palette.set('indigo') })
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  await act(async () => first.reject(new Error('first refused')))
  expect(post).toHaveBeenCalledTimes(2)
  expect(result.current.palette.palette).toBe('indigo')
  await act(async () => second.resolve({}))
  expect(qc.getQueryData(['whoami'])).toMatchObject({ palette: 'indigo' })
  expect(localStorage.getItem('fc_palette:Appearance A')).toBe('indigo')
})

test('rapid theme toggles use latest intent and roll all representations back to the successful dark write', async () => {
  const first = deferred(), second = deferred()
  const post = vi.spyOn(api, 'post').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  const { result, qc } = mount()
  act(() => { result.current.theme.toggle(); result.current.theme.toggle() })
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  expect(post).toHaveBeenNthCalledWith(1, '/api/set_theme', { theme: 'dark' })
  expect(result.current.theme.theme).toBe('light')
  await act(async () => first.resolve({}))
  expect(post).toHaveBeenNthCalledWith(2, '/api/set_theme', { theme: 'light' })
  expect(document.documentElement.dataset.theme).toBe('light')
  await act(async () => second.reject(new Error('second refused')))
  await waitFor(() => expect(result.current.theme.theme).toBe('dark'))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem('fc_theme:Appearance A')).toBe('dark')
  expect(qc.getQueryData(['whoami'])).toMatchObject({ theme: 'dark', palette: 'graphite' })
})

test('a failed theme write restores the server value rather than leaving its optimistic mirror', async () => {
  vi.spyOn(api, 'post').mockRejectedValue(new Error('refused'))
  const { result, qc } = mount()
  act(() => result.current.theme.set('dark'))
  await waitFor(() => expect(result.current.theme.theme).toBe('light'))
  expect(localStorage.getItem('fc_theme:Appearance A')).toBe('light')
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(qc.getQueryData(['whoami'])).toMatchObject({ theme: 'light' })
})

test('unmount and account switch prevent pending completion or queued choices reaching the next account', async () => {
  const first = deferred()
  const post = vi.spyOn(api, 'post').mockImplementation(() => first.promise)
  const { result, qc, unmount } = mount()
  act(() => { result.current.palette.set('ivory'); result.current.palette.set('indigo') })
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  unmount()
  setSession('next-token', { row_id: 'Appearance B', email: 'b@example.test', full_name: null })
  document.documentElement.dataset.palette = 'graphite'
  await act(async () => first.resolve({}))
  expect(post).toHaveBeenCalledTimes(1)
  expect(document.documentElement.dataset.palette).toBe('graphite')
  expect(localStorage.getItem('fc_palette:Appearance B')).toBeNull()
  expect(qc.getQueryData(['whoami'])).toMatchObject({ palette: 'graphite' })
})

test('a click before whoami resolves rolls back to the server confirmation, not the stale mirror', async () => {
  const identity = deferred(), write = deferred()
  vi.spyOn(api, 'get').mockImplementation(() => identity.promise)
  const post = vi.spyOn(api, 'post').mockImplementation(() => write.promise)
  document.documentElement.dataset.palette = 'graphite'
  const { result, qc } = mount(false)
  act(() => result.current.palette.set('indigo'))
  expect(result.current.palette.palette).toBe('indigo')
  expect(post).not.toHaveBeenCalled()
  await act(async () => identity.resolve({ palette: 'ivory', theme: 'light' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  expect(result.current.palette.palette).toBe('indigo')
  await act(async () => write.reject(new Error('refused')))
  await waitFor(() => expect(result.current.palette.palette).toBe('ivory'))
  expect(localStorage.getItem('fc_palette:Appearance A')).toBe('ivory')
  expect(qc.getQueryData(['whoami'])).toMatchObject({ palette: 'ivory' })
})
