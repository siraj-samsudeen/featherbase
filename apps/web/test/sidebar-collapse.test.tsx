// Collapsing the Admin sidebar (#1018, openspec/specs/admin-ui-feedback, "The
// Admin sidebar can be collapsed"). Real Admin in jsdom against the in-process
// server. What only a real layout can witness (the width a table gets, the
// sidebar actually hidden) is left for the layout tests (#1080).

import { cleanup, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

async function openAdmin(admin: Admin) {
  await renderApp('/featherbase/admin/all-tables', admin)
  return screen.findByTestId('sidebar-collapse', {}, { timeout: 8000 })
}
const collapsed = () => screen.getByTestId('admin-sidebar').hasAttribute('data-collapsed')

test('the control collapses and reopens the sidebar, and says what it will do', async ({ admin }) => {
  const control = await openAdmin(admin)
  expect(collapsed()).toBe(false)
  expect(control).toHaveAccessibleName('Collapse sidebar')
  expect(control.title).toMatch(/^Collapse sidebar \((⌘B|Ctrl\+B)\)$/)

  await userEvent.click(control)
  expect(collapsed()).toBe(true)
  expect(control).toHaveAccessibleName('Expand sidebar')
  expect(control.title).toMatch(/^Expand sidebar \((⌘B|Ctrl\+B)\)$/)

  await userEvent.click(control)
  expect(collapsed()).toBe(false)
})

test('Ctrl+B and Cmd+B do the same from the page, a button or a checkbox', async ({ admin }) => {
  await openAdmin(admin)
  // fireEvent returns false when the page took the key for itself.
  expect(fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true })).toBe(false)
  expect(collapsed()).toBe(true)
  expect(fireEvent.keyDown(document.body, { key: 'b', metaKey: true })).toBe(false)
  expect(collapsed()).toBe(false)

  fireEvent.keyDown(screen.getByTestId('sidebar-collapse'), { key: 'b', metaKey: true })
  expect(collapsed()).toBe(true)

  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  document.body.append(checkbox)
  fireEvent.keyDown(checkbox, { key: 'b', metaKey: true })
  checkbox.remove()
  expect(collapsed()).toBe(false)
})

test('in a text field or a rich-text editor the shortcut is left to the field', async ({ admin }) => {
  await openAdmin(admin)
  const editor = document.createElement('div')
  editor.setAttribute('contenteditable', 'true')
  editor.innerHTML = '<p>some text</p>'
  const textarea = document.createElement('textarea')
  document.body.append(editor, textarea)

  const fields = [screen.getByLabelText('Search or type a command'), textarea, editor, editor.querySelector('p')!]
  for (const field of fields) {
    // true: nothing took the key, so the editor's bold or the browser's own still applies.
    expect(fireEvent.keyDown(field, { key: 'b', metaKey: true })).toBe(true)
    expect(fireEvent.keyDown(field, { key: 'b', ctrlKey: true })).toBe(true)
    expect(collapsed()).toBe(false)
  }
  editor.remove()
  textarea.remove()
})

test("Chrome's bookmarks bar key is left alone, and holding the key toggles once", async ({ admin }) => {
  await openAdmin(admin)
  expect(fireEvent.keyDown(document.body, { key: 'B', ctrlKey: true, shiftKey: true })).toBe(true)
  expect(fireEvent.keyDown(document.body, { key: 'B', metaKey: true, shiftKey: true })).toBe(true)
  expect(collapsed()).toBe(false)

  fireEvent.keyDown(document.body, { key: 'b', metaKey: true })
  fireEvent.keyDown(document.body, { key: 'b', metaKey: true, repeat: true })
  expect(collapsed()).toBe(true)
})

test('the choice survives a reload, for this person only', async ({ admin }) => {
  await userEvent.click(await openAdmin(admin))
  expect(collapsed()).toBe(true)

  const stored = Object.keys(localStorage).filter((key) => key.startsWith('fc-sidebar-collapsed:'))
  expect(stored).toHaveLength(1)

  cleanup()
  await openAdmin(admin)
  expect(collapsed()).toBe(true)

  // Someone else's choice on this browser says nothing about this person.
  const [key] = stored
  localStorage.removeItem(key)
  localStorage.setItem(`${key}-someone-else`, '1')
  cleanup()
  await openAdmin(admin)
  expect(collapsed()).toBe(false)
})

test('with browser storage blocked the control still works for the visit', async ({ admin }) => {
  const blocked = () => { throw new DOMException('blocked', 'SecurityError') }
  const read = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    return key.startsWith('fc-sidebar-collapsed:') ? blocked() : read.call(this, key)
  })
  const write = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    return key.startsWith('fc-sidebar-collapsed:') ? blocked() : write.call(this, key, value)
  })
  await userEvent.click(await openAdmin(admin))
  expect(collapsed()).toBe(true)
})

test('at phone width the shortcut does nothing and a saved choice leaves the drawer alone', async ({ admin }) => {
  await userEvent.click(await openAdmin(admin))
  expect(collapsed()).toBe(true)
  cleanup()

  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
    matches: q === '(width < 48rem)', media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList)
  await openAdmin(admin)
  expect(collapsed()).toBe(false)
  expect(fireEvent.keyDown(document.body, { key: 'b', metaKey: true })).toBe(true)
  expect(collapsed()).toBe(false)
})
