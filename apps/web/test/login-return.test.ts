import { describe, expect, test } from 'vitest'
import { openLanding, openReturnPath, returnOrLanding, safeLoginNext } from '../src/pages/Login'

describe('login return path', () => {
  test('accepts canonical and application paths, preserving explicit or inherited state', () => {
    expect(safeLoginNext('/tasker/', '#task=TASK-00001'))
      .toBe('/tasker/#task=TASK-00001')
    expect(safeLoginNext('/other/review/item?filter=a%26b&owner=me', '#selected=42'))
      .toBe('/other/review/item?filter=a%26b&owner=me#selected=42')
    expect(safeLoginNext('/tasker/?view=work#task=EXPLICIT', '#task=INHERITED'))
      .toBe('/tasker/?view=work#task=EXPLICIT')
    expect(safeLoginNext('/featherbase/admin/table/user?view=active', '#row=Administrator'))
      .toBe('/featherbase/admin/table/user?view=active#row=Administrator')
  })

  // #1080, from e2e/runtime-login-return.spec.ts: repeated keys and escaped
  // characters in a runtime app's query come back exactly as they were sent.
  test('a runtime app query with repeated and escaped values returns unchanged, with the selected-work fragment', () => {
    expect(safeLoginNext('/tasker/?review=deep-link&note=37%20cartons%2F83&review=again', '#task=TASK-00001'))
      .toBe('/tasker/?review=deep-link&note=37%20cartons%2F83&review=again#task=TASK-00001')
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

describe('opening the return path after sign-in', () => {
  test("a runtime app's deep link, fragment and all, is opened by a full page load", () => {
    const pushed: string[] = []
    const loaded: string[] = []
    openReturnPath('/tasker/?review=deep-link#task=TASK-00001', (p) => pushed.push(p), (p) => loaded.push(p))
    expect([pushed, loaded]).toEqual([[], ['/tasker/?review=deep-link#task=TASK-00001']])
  })
})

// Found on staging (10-Nov-2026): a return path the person can't open must not send them to a
// no-access page that emails the admins; they go to where they land instead.
describe('a return path the person can open, else their landing', () => {
  const dashOnly = { row_id: 'psn_1', landing: '/dash/', apps: ['dash'] }
  test.each([
    ['the Admin, for someone who lands in an app', '/featherbase/admin/table/User', dashOnly, '/dash/'],
    ["an app they can't open", '/tasker/?view=work', dashOnly, '/dash/'],
    ['an app they can open, kept as it is', '/dash/?store=9901', dashOnly, '/dash/?store=9901'],
    ['a Featherbase page anyone signed in may open', '/featherbase/account/sign-in-methods', dashOnly, '/featherbase/account/sign-in-methods'],
    ['the Admin, for someone who lands in the Admin', '/featherbase/admin/table/User', { row_id: 'psn_2', apps: [] }, '/featherbase/admin/table/User'],
    ['anything, when the server named no apps', '/tasker/', { row_id: 'psn_3', landing: '/dash/' }, '/tasker/'],
  ])('%s', (_what, next, user, expected) => {
    expect(returnOrLanding(next, user)).toBe(expected)
  })
})
