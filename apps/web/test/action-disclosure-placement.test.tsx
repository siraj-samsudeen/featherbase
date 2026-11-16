// #1185: an action menu lines up with whichever edge of its button keeps it
// inside the visible area — the window, narrowed by every ancestor that clips
// its overflow. jsdom has no layout, so the boxes are stubbed here; the e2e
// spec action-menu-placement.spec.ts checks the same thing with real layout.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ActionDisclosure } from '../src/components/ActionDisclosure'

type Box = { left: number; width: number }

afterEach(() => vi.restoreAllMocks())

/** Stub the three boxes the menu measures: the clipping column, the button's wrapper and the menu. */
function layout({ column, trigger, menuWidth }: { column: Box; trigger: Box; menuWidth: number }) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box = this.matches('[data-testid="column"]')
      ? column
      : this.querySelector(':scope > button[aria-expanded]')
        ? trigger
        : this.matches('[role="group"]')
          ? { left: 0, width: menuWidth }
          : { left: 0, width: 0 }
    return DOMRect.fromRect({ x: box.left, y: 0, width: box.width, height: 36 })
  })
}

async function openMenu() {
  render(
    // overflowX, not the overflow shorthand: jsdom does not expand it, as browsers do.
    <div data-testid="column" style={{ overflowX: 'auto' }}>
      <ActionDisclosure label="Record actions">
        <button type="button">Delete permanently</button>
      </ActionDisclosure>
    </div>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Record actions' }))
  return screen.getByRole('group', { name: 'Record actions' })
}

test('with room to its left, the menu lines up with the button’s right edge, as before', async () => {
  layout({ column: { left: 100, width: 900 }, trigger: { left: 800, width: 150 }, menuWidth: 256 })
  expect((await openMenu()).dataset.align).toBe('end')
})

test('at the left of a clipping column, the menu lines up with the button’s left edge instead', async () => {
  // The window has room to the left (the sidebar), but the column clips it.
  layout({ column: { left: 328, width: 1024 }, trigger: { left: 328, width: 153 }, menuWidth: 256 })
  expect((await openMenu()).dataset.align).toBe('start')
})

test('with room on neither side, the menu takes the side with more room: here the right', async () => {
  layout({ column: { left: 0, width: 300 }, trigger: { left: 40, width: 150 }, menuWidth: 280 })
  expect((await openMenu()).dataset.align).toBe('start')
})

test('with room on neither side, the menu takes the side with more room: here the left', async () => {
  layout({ column: { left: 0, width: 300 }, trigger: { left: 110, width: 150 }, menuWidth: 280 })
  expect((await openMenu()).dataset.align).toBe('end')
})
