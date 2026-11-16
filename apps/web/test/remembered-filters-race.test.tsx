// #1228, Codex review round 8: a read of the remembered filters that began
// before a change made in this tab never overwrites that change.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { rememberFilters, useRememberedFilters } from '../src/lib/remembered-filters'

afterEach(() => vi.restoreAllMocks())

test('a slow read from before a change does not bring back the older filters', async () => {
  const TABLE = 'rfr slow table'
  let answer!: () => void
  const late = new Promise<void>((resolve) => { answer = resolve })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (init?.method === 'PUT') return Response.json({ ok: true })
    // The server still holds the older filters; its answer arrives late.
    await late
    return Response.json({ settings: { filters: [['store', '=', 'Old']] } })
  })
  const first = renderHook(() => useRememberedFilters(TABLE, true))
  expect(first.result.current).toBeUndefined()
  first.unmount()
  // Meanwhile, on a filtered list of the same Table, the person chose New.
  act(() => rememberFilters(TABLE, [['store', '=', 'New']]))
  answer()
  await new Promise((r) => setTimeout(r, 20))
  const again = renderHook(() => useRememberedFilters(TABLE, true))
  await waitFor(() => expect(again.result.current).toEqual([['store', '=', 'New']]))
})
