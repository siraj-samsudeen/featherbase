import { expect, test } from 'vitest'
import { APP_ROOT_PATTERN, RESERVED_APP_ROOTS, appHref } from '../src/index'

test('PKG-R4: app routes and reserved platform prefixes are disjoint', () => {
  const app = new RegExp(APP_ROOT_PATTERN)
  for (const root of RESERVED_APP_ROOTS) {
    expect(app.test(`/${root}`)).toBe(false)
    expect(app.test(`/${root}/nested`)).toBe(false)
  }
  for (const name of ['tasker', 'other', 'helpdesk', 'apiary']) {
    expect(appHref(name)).toBe(`/${name}/`)
    expect(app.test(appHref(name))).toBe(true)
    expect(app.test(`/${name}/assets/main.js`)).toBe(true)
  }
  for (const path of ['/', '/@vite/client', '/favicon.ico', '/123task/'])
    expect(app.test(path)).toBe(false)
})
