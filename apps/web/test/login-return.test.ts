import { describe, expect, test } from 'vitest'
import { openLanding, safeLoginNext } from '../src/pages/Login'

describe('login return path', () => {
  test('accepts canonical and application paths, preserving explicit or inherited state', () => {
    expect(safeLoginNext('/tasker/', '#task=TASK-00001'))
      .toBe('/tasker/#task=TASK-00001')
    expect(safeLoginNext('/other/review/item?filter=a%26b&owner=me', '#selected=42'))
      .toBe('/other/review/item?filter=a%26b&owner=me#selected=42')
    expect(safeLoginNext('/tasker/?view=work#task=EXPLICIT', '#task=INHERITED'))
      .toBe('/tasker/?view=work#task=EXPLICIT')
    expect(safeLoginNext('/featherbase/admin/User?view=active', '#row=Administrator'))
      .toBe('/featherbase/admin/User?view=active#row=Administrator')
  })

  test.each([
    'https://attacker.example/tasker/',
    '//attacker.example/tasker/',
    '/\\attacker.example/tasker/',
    '/%5Cattacker.example/tasker/',
    '/\t/attacker.example/tasker/',
    '/api/whoami',
    '/admin/User',
    '/login',
    '/assets/main.js',
    '/tasker/%E0%A4%A',
    '/tasker/?filter=%E0%A4%A',
  ])('refuses an external or ambiguous return path: %s', (next) => {
    expect(safeLoginNext(next, '#task=TASK-00001')).toBeUndefined()
  })
})

// #488 (Codex round 1): a landing outside the SPA, such as an installed
// app's root on its own address, needs a full page load, as a return path does.
describe('opening the landing after sign-in', () => {
  const user = (landing: string) => ({ row_id: 'p', email: null, full_name: null, landing })

  test("an app's root is opened by a full page load", () => {
    const pushed: string[] = []
    const loaded: string[] = []
    openLanding(user('/tasker/'), (p) => pushed.push(p), (p) => loaded.push(p))
    expect([pushed, loaded]).toEqual([[], ['/tasker/']])
  })

  test('a Featherbase page is opened inside the SPA', () => {
    const pushed: string[] = []
    const loaded: string[] = []
    openLanding(user('/featherbase/sales-target'), (p) => pushed.push(p), (p) => loaded.push(p))
    expect([pushed, loaded]).toEqual([['/featherbase/sales-target'], []])
  })
})
