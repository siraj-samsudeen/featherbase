import { describe, expect, test } from 'vitest'
import { safeLoginNext } from '../src/pages/Login'

describe('login return path', () => {
  // @spec featherbase_human_routes_are_canonical.exact_runtime_app_location_survives_sign_in
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

  // @spec featherbase_human_routes_are_canonical.unsafe_login_return_is_refused
  test.each([
    'https://attacker.example/tasker/',
    '//attacker.example/tasker/',
    '/\\attacker.example/tasker/',
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
