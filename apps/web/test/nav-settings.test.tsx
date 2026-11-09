import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { api, clearSession, setSession } from '../src/lib/api'
import { EMPTY_PATH, push, type NavStep } from '../src/lib/nav-path'
import { NAVIGATION_SETTINGS, useNavigationSettings } from '../src/lib/nav-settings'
import { test, expect } from './pg-test'

// #910 D2: the person's recent walks are saved as whole snapshots, so the
// saves must land in the order the person made them.

afterEach(() => {
  vi.restoreAllMocks()
  clearSession()
})

const sites: NavStep = { screen: 'list', table: 'Site' }
const kerala: NavStep = { screen: 'list', table: 'Site', filters: [['state', '=', 'KL']] }
const enchakkal: NavStep = { ...kerala, pane: { table: 'Site', row: 'site-1' } }

test('two quick saves of the recent walks land the newer one last', async ({ admin }) => {
  if (!admin.token) throw new Error('The signed-in fixture needs a session token')
  setSession(admin.token, { row_id: 'Administrator', email: 'admin@example.test', full_name: null })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const { result } = renderHook(() => useNavigationSettings(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  })
  await waitFor(() => expect(result.current.ready).toBe(true))
  // The first save is slow to reach the server; the second is not held.
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const real = api.put
  const put = vi.spyOn(api, 'put').mockImplementationOnce(async (path, body) => {
    await gate
    return real(path, body)
  })
  const shorter = push(push(EMPTY_PATH, sites), kerala)
  const longer = push(shorter, enchakkal)
  act(() => result.current.remember(shorter))
  act(() => result.current.remember(longer))
  release()
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
  await Promise.all(put.mock.results.map((r) => r.value))
  const { settings } = await admin.get<{ settings: { recentPaths?: unknown[] } | null }>(`/api/user_settings/${NAVIGATION_SETTINGS}`)
  expect(settings?.recentPaths).toHaveLength(1)
  expect(JSON.parse(settings!.recentPaths![0] as string).steps).toHaveLength(3)
  qc.clear()
})

test('a pane place the server could not save is kept for this visit', async ({ admin }) => {
  if (!admin.token) throw new Error('The signed-in fixture needs a session token')
  setSession(admin.token, { row_id: 'Administrator', email: 'admin@example.test', full_name: null })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const { result } = renderHook(() => useNavigationSettings(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  })
  await waitFor(() => expect(result.current.ready).toBe(true))
  // The network drops as the choice is saved.
  const put = vi.spyOn(api, 'put').mockRejectedValueOnce(new TypeError('Failed to fetch'))
  act(() => result.current.setPanePlace('bottom'))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  await expect(put.mock.results[0].value).rejects.toThrow('Failed to fetch')
  expect(result.current.panePlace).toBe('bottom')
  const { settings } = await admin.get<{ settings: { panePlace?: string } | null }>(`/api/user_settings/${NAVIGATION_SETTINGS}`)
  expect(settings?.panePlace).toBeUndefined()
  qc.clear()
})
