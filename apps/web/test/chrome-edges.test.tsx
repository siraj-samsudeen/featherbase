// Main's coverage after the 16-Nov chrome and names work: what the shared sidebar, the remembered
// filters and the actor names do when a call fails or is made twice.
import { createElement, type ReactNode } from 'react'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api } from '../src/lib/api'
import { attachSidebarEdge, readSidebar, registerSidebar, useSidebar } from '../src/lib/sidebar-collapsed'
import { rememberFilters, useRememberedFilters } from '../src/lib/remembered-filters'
import { ActorName, usePrincipalNameState } from '../src/lib/people'

afterEach(() => vi.restoreAllMocks())
const withQueries = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children)

describe('the shared sidebar (#1227)', () => {
  test('a sidebar that leaves twice is counted once', () => {
    const { result } = renderHook(() => useSidebar())
    const before = result.current
    const leave = registerSidebar()
    leave()
    leave()
    expect(renderHook(() => useSidebar()).result.current).toMatchObject({ collapsed: before.collapsed, drawerOpen: false })
  })

  // #1290: the edge's drag at its edges: another button is no drag, and a width
  // that can't be kept (nobody signed in, storage refused) still holds for the visit.
  test("the edge: another button is no drag; a width that can't be kept still holds for the visit", () => {
    localStorage.clear()
    const leave = registerSidebar()
    const frame = document.createElement('div')
    const edge = document.createElement('div')
    document.body.append(frame, edge)
    const detach = attachSidebarEdge(edge, { frame: () => frame, widthVar: '--w' })
    const drag = (button: number, to: number) => {
      fireEvent.pointerDown(edge, { button, clientX: 500, pointerId: 1 })
      fireEvent.pointerMove(document, { clientX: to, pointerId: 1 })
      fireEvent.pointerUp(document, { clientX: to, pointerId: 1 })
    }
    expect(readSidebar().width).toBe(240)
    drag(2, 580)
    expect(readSidebar().width).toBe(240)

    // Nobody signed in: the width holds, and nothing is kept.
    drag(0, 560)
    expect(readSidebar().width).toBe(300)
    expect(Object.keys(localStorage)).toEqual([])

    // Signed in, but the browser refuses to keep it.
    localStorage.setItem('fc_user', JSON.stringify({ row_id: 'someone', email: null, full_name: null }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(readSidebar().width).toBe(240)
    drag(0, 590)
    expect(readSidebar().width).toBe(330)

    // Back at the default width, nothing is kept: the stored width is cleared.
    vi.restoreAllMocks()
    localStorage.setItem('fc-sidebar-width:someone', '330')
    drag(0, 410)
    expect(readSidebar().width).toBe(240)
    expect(localStorage.getItem('fc-sidebar-width:someone')).toBeNull()

    detach()
    leave()
    vi.restoreAllMocks()
    localStorage.clear()
    frame.remove()
    edge.remove()
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
