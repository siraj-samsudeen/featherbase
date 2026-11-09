// Small helpers whose edges no page reaches on its own: a refusal that is not
// the server's, and the sidebar's collapsed choice with nobody signed in.
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { refusalMessage } from '../src/lib/table-refusal'
import { useSidebarCollapsed } from '../src/lib/sidebar-collapsed'

afterEach(() => localStorage.clear())

describe('refusalMessage', () => {
  test('a failure that is not the server’s refusal reads as the fallback', () => {
    expect(refusalMessage(new TypeError('Failed to fetch'), 'The Table could not be saved')).toBe('The Table could not be saved')
  })
})

describe('the sidebar’s collapsed choice', () => {
  test('with nobody signed in it starts open and is kept for the visit only', () => {
    const { result } = renderHook(() => useSidebarCollapsed(undefined))
    expect(result.current[0]).toBe(false)
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
    expect(localStorage.length).toBe(0)
  })
})
