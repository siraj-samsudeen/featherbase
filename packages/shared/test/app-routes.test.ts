import { describe, expect, test } from 'vitest'
import { APP_ROOT_PATTERN, APP_TAB_ICONS, APP_TAB_LABEL_MAX, APP_TAB_PATH, FEATHERBASE_ADMIN_DESTINATION, LEGACY_HUMAN_ROOT_PATTERN, RESERVED_APP_ROOTS, appHref, appTabLinks, tableHref, rowHref } from '../src/index'

test.each([
  ['Sign In Method', '/featherbase/admin/table/sign-in-method'],
  [' New--Table__ ', '/featherbase/admin/table/new-table'],
  ['tasker.task_item', '/featherbase/admin/table/tasker.task-item'],
])('Table destinations normalize separators without losing qualification: %s', (name, href) => {
  expect(tableHref(name)).toBe(href)
})

test.each([
  ['new', 'new'],
  ['columns', 'columns'],
  ['A / B?x#%', 'A%20%2F%20B%3Fx%23%25'],
])('row destinations encode the unchanged ID separately: %s', (id, encoded) => {
  expect(rowHref('Sign In Method', id)).toBe(`/featherbase/admin/table/sign-in-method/row/${encoded}`)
})

test('the canonical Featherbase destination has its product label and path', () => {
  expect(FEATHERBASE_ADMIN_DESTINATION).toEqual({
    label: 'Featherbase',
    href: '/featherbase/admin',
  })
})

test('PKG-R4: app routes and reserved platform prefixes are disjoint', () => {
  const app = new RegExp(APP_ROOT_PATTERN)
  const legacyHuman = new RegExp(LEGACY_HUMAN_ROOT_PATTERN)
  for (const root of RESERVED_APP_ROOTS) {
    expect(app.test(`/${root}`)).toBe(false)
    expect(app.test(`/${root}/nested`)).toBe(false)
    expect(app.test(`/${root}?query=reserved`)).toBe(false)
  }
  for (const root of ['admin', 'login', 'form', 'portal', 'print', 'oauth-callback', 'reset-password']) {
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

import { ADMIN_STATIC_PAGES, adminPageNeedsManage, adminPageTitle } from '../src/index'

test('every static admin page has a unique slug and a title', () => {
  const slugs = ADMIN_STATIC_PAGES.map((p) => p.slug)
  expect(new Set(slugs).size).toBe(slugs.length)
  expect(adminPageTitle('access-tokens')).toBe('Access tokens')
  expect(adminPageTitle('nope')).toBeUndefined()
})

test('only the System Manager pages need manage (#465, #476 recents rule)', () => {
  expect(adminPageNeedsManage('instance-health')).toBe(true)
  expect(adminPageNeedsManage('waiting-for-access')).toBe(true)
  expect(adminPageNeedsManage('imports')).toBe(true)
  expect(adminPageNeedsManage('access-tokens')).toBe(false)
  expect(adminPageNeedsManage('no-such-page')).toBe(false)
})

// #380 task 4.4: an interim app's tabs are typed only, not validated like a
// manifest's, so the same rules are pinned here.
describe('interim app tabs', () => {
  test('tab paths allow lower-case relative segments, never a route outside the app', () => {
    for (const path of ['', 'inbox', '1', 'my-work/2026_10', 'reports/daily']) {
      expect(path).toMatch(APP_TAB_PATH)
    }
    for (const path of ['/inbox', '../admin', 'inbox/../admin', 'inbox/', 'inbox//daily', 'Inbox', 'a/B', '_private', 'a/_private', 'a?b', 'a#b', 'a\nb']) {
      expect(path).not.toMatch(APP_TAB_PATH)
    }
  })

  test('tab links sit under the app root, with or without its trailing slash', () => {
    expect(appTabLinks('/other/', [{ label: 'Today', icon: 'home', path: '' }, { label: 'Targets', icon: 'target', path: 'targets' }]))
      .toEqual([{ label: 'Today', icon: 'home', href: '/other/' }, { label: 'Targets', icon: 'target', href: '/other/targets' }])
    expect(appTabLinks('/shop', [{ label: 'Report', icon: 'report', path: '' }, { label: 'Me', icon: 'person', path: 'me' }]))
      .toEqual([{ label: 'Report', icon: 'report', href: '/shop' }, { label: 'Me', icon: 'person', href: '/shop/me' }])
  })
})
