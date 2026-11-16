// Main's coverage after the 16-Nov chrome and names work: what the shared sidebar, the remembered
// filters and the actor names do when a call fails or is made twice.
import { createElement, type ReactNode } from 'react'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api } from '../src/lib/api'
import { registerSidebar, useSidebar } from '../src/lib/sidebar-collapsed'
import { rememberFilters, useRememberedFilters } from '../src/lib/remembered-filters'
import { ActorName, usePrincipalNameState } from '../src/lib/people'

afterEach(() => vi.restoreAllMocks())
const withQueries = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children)

describe('the shared sidebar (#1227)', () => {
  test('a sidebar that leaves twice is counted once', () => {
    const { result } = renderHook(() => useSidebar('someone'))
    const before = result.current
    const leave = registerSidebar('someone')
    leave()
    leave()
    expect(renderHook(() => useSidebar('someone')).result.current).toMatchObject({ collapsed: before.collapsed, drawerOpen: false })
  })
})

describe('the remembered filters (#1228)', () => {
  test('a save that fails is dropped, and the next save still goes', async () => {
    const put = vi.spyOn(api, 'put').mockRejectedValueOnce(new Error('offline')).mockResolvedValue({} as never)
    rememberFilters('Some Table', [['store', '=', 'Lakeside']])
    rememberFilters('Some Table', [])
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
    expect(put.mock.calls[1][1]).toEqual({ filters: [] })
  })

  test('a read that fails opens the list with no filters', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useRememberedFilters('Some Table', true))
    await waitFor(() => expect(result.current).toEqual([]))
  })
})

describe('who did something (#1224)', () => {
  test('without a name from the server, a plain value is shown as it is', () => {
    render(createElement(withQueries, null, createElement(ActorName, { id: 'Nightly import' })))
    expect(screen.getByText('Nightly import')).toBeInTheDocument()
    expect(screen.queryByTestId('principal-name')).not.toBeInTheDocument()
  })

  test('when the batch of actor names fails, the name is unknown rather than an error', async () => {
    const id = 'psn_abcdefghijklmnopqrst'
    const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => usePrincipalNameState(id, 'Some Table'), { wrapper: withQueries })
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/people/actor_names', { table: 'Some Table', ids: [id] }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.name).toBeNull()
  })
})
