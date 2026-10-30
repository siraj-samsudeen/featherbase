// #650, GitHub Codex on #658: in a production build the theme modules can sit
// in a chunk shared by the Admin and the bar bundle, so they load before the
// bar has chosen where to paint. Over an app's page an import-time paint would
// overwrite the app's own <html data-theme>. No theme module paints as it
// loads; each entry paints when it starts (main.tsx, src/bar/mount.tsx).
import { expect, test, vi } from 'vitest'

test("loading the theme modules leaves the page's root untouched", async () => {
  document.documentElement.setAttribute('data-theme', 'app-owned')
  try {
    vi.resetModules()
    await import('@featherbase/shop-floor/theme')
    await import('../src/lib/theme')
    expect(document.documentElement.getAttribute('data-theme')).toBe('app-owned')
  } finally {
    document.documentElement.removeAttribute('data-theme')
  }
})

test('choosing a theme broadcasts it to an installed app without painting its root', async () => {
  vi.resetModules()
  const { paintOnto, THEME_CHANGE_EVENT } = await import('@featherbase/shop-floor/theme')
  const { applyTheme } = await import('../src/lib/theme')
  const bar = document.createElement('div')
  document.documentElement.dataset.theme = 'light'
  paintOnto(bar)
  const selected: unknown[] = []
  const receive = (event: Event) => selected.push((event as CustomEvent).detail)
  window.addEventListener(THEME_CHANGE_EVENT, receive)
  try {
    applyTheme('dark')
    expect(selected).toEqual(['dark'])
    expect(bar.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('light')
  } finally {
    window.removeEventListener(THEME_CHANGE_EVENT, receive)
    document.documentElement.removeAttribute('data-theme')
  }
})
