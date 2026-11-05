// #941 (design D2): <featherbase-sidebar> draws in a shadow root, which the
// accent on the app's <html> cannot reach. It copies the app's accent from the
// bar's host onto its frame, the element that also carries its painted theme,
// so the accent's dark block matches after a theme switch.
import { afterEach, describe, expect, test } from 'vitest'
import { FeatherbaseSidebar } from '../src/bar/sidebar'

if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)

afterEach(() => document.body.replaceChildren())

/** A bar host the way the server writes it, with its painted theme root. */
function barHost(accent?: string) {
  const host = document.createElement('featherbase-bar')
  if (accent) host.dataset.accent = accent
  const root = document.createElement('div')
  root.dataset.testid = 'bar-theme-root'
  root.dataset.theme = 'dark'
  host.attachShadow({ mode: 'open' }).append(root)
  document.body.append(host)
}

function sidebarFrame() {
  const sidebar = document.createElement('featherbase-sidebar')
  document.body.append(sidebar)
  return sidebar.shadowRoot!.querySelector<HTMLElement>('.sidebar-frame')!
}

describe("the sidebar's frame", () => {
  test("carries the app's accent beside its theme", () => {
    barHost('green')
    const frame = sidebarFrame()
    expect([frame.dataset.theme, frame.getAttribute('data-featherbase-accent')]).toEqual(['dark', 'green'])
  })

  test('carries no accent when the app names none', () => {
    barHost()
    expect(sidebarFrame().hasAttribute('data-featherbase-accent')).toBe(false)
  })
})
