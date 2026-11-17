// #1229, Codex review rounds 3 and 4: the person's stars on shared views live
// in their navigation settings. A star may change only once those settings were
// actually read from the server: before that, or after a failed read (even once
// another choice, such as where the pane sits, was written optimistically), the
// stars are unknown, and saving would overwrite them.
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useNavigationSettings } from '../src/lib/nav-settings'

afterEach(() => vi.restoreAllMocks())

/** The settings endpoint: `read` answers the GET; every PUT body is kept. */
function settingsServer(read: () => Response) {
  const puts: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!path.includes('/api/user_settings/__navigation')) return new Response('{}', { status: 404 })
    if (init?.method === 'PUT') { puts.push(JSON.parse(String(init.body))); return Response.json({ ok: true }) }
    return read()
  })
  return puts
}

function hook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => useNavigationSettings(), { wrapper })
}

describe('stars on shared views', () => {
  test('read from the server, they can be changed, keeping the ones already there', async () => {
    const puts = settingsServer(() => Response.json({ settings: { starredViews: ['v1'] } }))
    const { result } = hook()
    await waitFor(() => expect(result.current.starsLoaded).toBe(true))
    act(() => result.current.toggleStar('v2'))
    await waitFor(() => expect(puts).toContainEqual({ starredViews: ['v1', 'v2'] }))
  })

  test('with the settings unreadable, no star changes, even after another choice was saved', async () => {
    const puts = settingsServer(() => new Response('{}', { status: 503 }))
    const { result } = hook()
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.setPanePlace('right'))
    await waitFor(() => expect(puts).toContainEqual({ panePlace: 'right' }))
    expect(result.current.starsLoaded).toBe(false)
    act(() => result.current.toggleStar('v2'))
    await new Promise((r) => setTimeout(r, 50))
    expect(puts.some((body) => typeof body === 'object' && body !== null && 'starredViews' in body)).toBe(false)
  })
})
