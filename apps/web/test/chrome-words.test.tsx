// What the chrome says in the cases its pages rarely meet: Admin → Apps' "Opens
// for" line (#1236 option A) and a page that gives the tab no title (#1227).
import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { opensForWords } from '../src/pages/Apps'
import { useCurrentPageTitle, usePageTitle } from '../src/lib/page-title'

test('Admin → Apps says who an app opens for, in each case', () => {
  const who = { everyone: false, roles: [] as string[], gated: false }
  expect(opensForWords('Tasker', who)).toBe('No role opens it yet')
  expect(opensForWords('Tasker', { ...who, everyone: true })).toBe('Opens for everyone')
  expect(opensForWords('Dash', { ...who, roles: ['Dash Reader', 'Report Access Manager'] })).toBe('Opens for: Dash Reader, Report Access Manager')
  expect(opensForWords('Dash', { ...who, roles: ['Dash Reader'], admits: ['Store Manager'], gated: true }))
    .toBe("Opens for: Dash Reader, and only for Store Manager, then Dash's own check")
})

test('a page that gives no title leaves the tab to the app name', () => {
  const { result } = renderHook(() => { usePageTitle(undefined); return useCurrentPageTitle() })
  expect(result.current).toBeUndefined()
  const named = renderHook(() => { usePageTitle('Sign-In Methods'); return useCurrentPageTitle() })
  expect(named.result.current).toBe('Sign-In Methods')
  named.unmount()
  expect(renderHook(() => useCurrentPageTitle()).result.current).toBeUndefined()
})
