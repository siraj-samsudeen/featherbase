import { expect, test } from 'vitest'
import { APP_ROOT_PATTERN, LEGACY_HUMAN_ROOT_PATTERN, RESERVED_APP_ROOTS, appHref } from '../src/index'

test('PKG-R4: app routes and reserved platform prefixes are disjoint', () => {
  const app = new RegExp(APP_ROOT_PATTERN)
  const legacyHuman = new RegExp(LEGACY_HUMAN_ROOT_PATTERN)
  for (const root of RESERVED_APP_ROOTS) {
    expect(app.test(`/${root}`)).toBe(false)
    expect(app.test(`/${root}/nested`)).toBe(false)
    expect(app.test(`/${root}?query=reserved`)).toBe(false)
  }
  for (const root of ['admin', 'login', 'form', 'portal', 'print', 'oauth-callback', 'reset-password', 'sales-target']) {
    expect(legacyHuman.test(`/${root}`)).toBe(true)
    expect(legacyHuman.test(`/${root}/nested`)).toBe(true)
    expect(legacyHuman.test(`/${root}?query=preserved`)).toBe(true)
  }
  for (const path of ['/administrator', '/login-extra', '/formidable'])
    expect(legacyHuman.test(path)).toBe(false)
  for (const name of ['tasker', 'other', 'helpdesk', 'apiary']) {
    expect(appHref(name)).toBe(`/${name}/`)
    expect(app.test(appHref(name))).toBe(true)
    expect(app.test(`/${name}?query=preserved`)).toBe(true)
    expect(app.test(`/${name}/assets/main.js`)).toBe(true)
  }
  for (const path of ['/', '/@vite/client', '/favicon.ico', '/123task/'])
    expect(app.test(path)).toBe(false)
})
