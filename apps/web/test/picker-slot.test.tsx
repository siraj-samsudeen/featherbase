// #1385 (slice 3): the app's pickers have one place in the page panel at a time. A sidebar that drew it, then
// gave way to another, releasing late must not take the newer sidebar's place away.
import { act, renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { offerPickerSlot, usePickerSlot } from '../src/lib/sidebar-collapsed'

test('a late release of a replaced picker slot leaves the newer one; its own release clears it', () => {
  const first = document.createElement('div')
  const second = document.createElement('div')
  const seen = renderHook(() => usePickerSlot())
  let releaseFirst!: () => void
  let releaseSecond!: () => void
  act(() => { releaseFirst = offerPickerSlot(first) })
  expect(seen.result.current).toBe(first)
  act(() => { releaseSecond = offerPickerSlot(second) })
  expect(seen.result.current).toBe(second)
  act(() => releaseFirst())
  expect(seen.result.current).toBe(second)
  act(() => releaseSecond())
  expect(seen.result.current).toBeUndefined()
  seen.unmount()
})
