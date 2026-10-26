// Pages that keep a convenience in site data, in a browser that blocks it
// (Safari private mode, a locked-down profile): each falls back instead of
// failing. Gaps the merged web coverage report (ADR 0012) showed. Blocked
// storage is a spy on the browser's Storage, throwing for the keys concerned.
import { screen } from '@testing-library/react'
import { afterEach, expect as vexpect, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

function blockKeys(match: (key: string) => boolean) {
  const read = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (match(key)) throw new DOMException('blocked', 'SecurityError')
    return read.call(this, key)
  })
}

test('All tables opens with the System group closed', async ({ admin }) => {
  localStorage.setItem('fc_sidebar_system_open', '1')
  blockKeys((k) => k === 'fc_sidebar_system_open')
  await renderApp('/featherbase/admin/all-tables', admin)
  expect(await screen.findByTestId('system-group-toggle', {}, { timeout: 8000 })).toHaveAttribute('aria-expanded', 'false')
})

test('Recent actions saved in a form this version cannot read count as none', async ({ admin }) => {
  localStorage.setItem(`fc-recents:${admin.user}`, '{not json')
  const { recentActions } = await import('../src/lib/recents')
  expect(recentActions(admin.user!, 10)).toEqual([])
  await renderApp('/featherbase/admin', admin)
  await screen.findByTestId('admin-sidebar', {}, { timeout: 8000 })
  expect(screen.queryByTestId('sidebar-recent')).not.toBeInTheDocument()
})

test('before React renders, a theme that cannot be read follows the device', async () => {
  localStorage.setItem('fc_user', JSON.stringify({ row_id: 'Blocked Theme', email: null, full_name: null }))
  localStorage.setItem('fc_theme:Blocked Theme', 'dark')
  blockKeys(() => true)
  vi.resetModules()
  await import('../src/lib/theme')
  const { paintedChoice } = await import('../src/lib/theme-paint')
  vexpect(paintedChoice()).toBe('device')
})
