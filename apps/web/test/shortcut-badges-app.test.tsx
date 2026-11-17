// #1251 on an app's page: the bar (in its own shadow root) draws the Keyboard
// Shortcuts panel, and the sidebar's key badge reaches the Collapse control
// inside <featherbase-sidebar>'s own shadow root (#1248). Mounted the way an
// app's served document mounts them, as app-sidebar-collapse.test.tsx does.
import { act, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { setSession } from '../src/lib/api'
import { mountBar } from '../src/bar/mount'
import { FeatherbaseSidebar } from '../src/bar/sidebar'
import { test, expect } from './pg-test'

if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)

let mounted: { unmount: () => void } | undefined
beforeEach(() => localStorage.clear())
afterEach(() => {
  act(() => mounted?.unmount())
  mounted = undefined
  document.body.replaceChildren()
})

test("on an app's page the sidebar's key badge sits on the Collapse control inside the sidebar", async ({ admin }) => {
  setSession(admin.token!, { row_id: admin.user!, email: null, full_name: null })
  const bar = document.createElement('featherbase-bar')
  bar.dataset.app = 'tasker'
  bar.dataset.title = 'Tasker'
  document.body.prepend(bar)
  mounted = mountBar(bar)
  const sidebar = document.createElement('featherbase-sidebar')
  sidebar.setAttribute('aria-label', 'Task views')
  document.body.append(sidebar)

  const inBar = (selector: string) => bar.shadowRoot?.querySelector<HTMLElement>(selector) ?? null
  await waitFor(() => expect(inBar('[data-testid="shortcuts-button"]')).not.toBeNull(), { timeout: 8000 })
  const collapse = await waitFor(() => {
    const control = sidebar.shadowRoot?.querySelector<HTMLElement>('[data-shortcut-id="sidebar"]')
    expect(control).toBeTruthy()
    return control!
  })

  fireEvent.keyDown(document.body, { key: '?', shiftKey: true })
  await waitFor(() => expect(inBar('[role="dialog"][aria-label="Keyboard Shortcuts"]')).not.toBeNull())
  const badge = inBar('[data-testid="shortcut-badge-sidebar"]')
  expect(badge).not.toBeNull()
  expect(badge!.textContent).toBe(collapse.dataset.shortcutKey)
  expect(badge!.textContent).toMatch(/^(⌘B|Ctrl\+B)$/)
})
