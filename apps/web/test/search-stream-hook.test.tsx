// #1265: how the bar's search ends when the answer is not a whole stream: a
// refusal, a body that is not JSON, a stream cut short, a dropped connection.
// Each must end the search as failed, never as "nothing found".
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const send = vi.hoisted(() => vi.fn<(path: string, init?: RequestInit) => Promise<Response>>())
vi.mock('../src/lib/api', () => ({ send }))

import { useStreamedSearch } from '../src/lib/search-stream'
import { pageLoad } from '../src/lib/page-load'

const stream = (text: string) =>
  new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close() } }))

async function settled(query: string) {
  const { result } = renderHook(() => useStreamedSearch(query))
  await waitFor(() => expect(result.current.done).toBe(true))
  return result.current
}

afterEach(() => { send.mockReset(); vi.restoreAllMocks() })

describe('useStreamedSearch ends as failed', () => {
  it('when the server refuses with an error other than a conflict', async () => {
    send.mockResolvedValue(new Response('oops', { status: 500 }))
    expect(await settled('moh')).toMatchObject({ done: true, failed: true })
  })

  it('when a conflict has no readable body, without reloading the page', async () => {
    const reload = vi.spyOn(pageLoad, 'reload').mockImplementation(() => {})
    send.mockResolvedValue(new Response('not json', { status: 409 }))
    expect(await settled('moh')).toMatchObject({ done: true, failed: true })
    expect(reload).not.toHaveBeenCalled()
  })

  it('when the stream ends before its done line', async () => {
    send.mockResolvedValue(stream('{"groups":[{"table":"Person","label":"Person"}]}\n'))
    expect(await settled('moh')).toMatchObject({ done: true, failed: true, groups: [{ table: 'Person' }] })
  })

  it('when the connection drops', async () => {
    send.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await settled('moh')).toMatchObject({ done: true, failed: true })
  })
})

it('a whole stream ends done and not failed', async () => {
  send.mockResolvedValue(stream('{"groups":[]}\n{"done":true}\n'))
  expect(await settled('moh')).toMatchObject({ done: true, failed: false })
})

it('clearing the query empties the search without asking the server', async () => {
  send.mockResolvedValue(stream('{"groups":[]}\n{"done":true}\n'))
  const { result, rerender } = renderHook(({ q }) => useStreamedSearch(q), { initialProps: { q: 'moh' } })
  await waitFor(() => expect(result.current.query).toBe('moh'))
  rerender({ q: '' })
  expect(result.current).toEqual({ query: '', groups: [], done: true, failed: false })
  expect(send).toHaveBeenCalledTimes(1)
})

it('reloads the page when View as ended while it searched', async () => {
  const reload = vi.spyOn(pageLoad, 'reload').mockImplementation(() => {})
  send.mockResolvedValue(Response.json({ error: { message: 'View as has ended' } }, { status: 409 }))
  renderHook(() => useStreamedSearch('moh'))
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
})
