// Production, 20-Nov-2026: on a Dash report, View As's list opened from the sidebar was drawn behind the report
// panel and its Dive iframe. A menu or picker opened from the sidebar is lifted into the browser's top layer and
// placed beside the control that opened it.
import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useTopLayer, type TopLayerPlace } from '@featherbase/shop-floor'

const shown = vi.fn()
const hidden = vi.fn()
beforeEach(() => {
  shown.mockReset()
  hidden.mockReset()
  Object.assign(HTMLElement.prototype, { showPopover: shown, hidePopover: hidden })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 130, left: 20, right: 220, width: 200, height: 30, x: 20, y: 100, toJSON: () => ({}) })
  vi.stubGlobal('innerWidth', 1440)
  vi.stubGlobal('innerHeight', 900)
})
afterEach(() => {
  // Unmounted while the Popover API is still stubbed: closing calls hidePopover.
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover
  delete (HTMLElement.prototype as Partial<HTMLElement>).hidePopover
})

function Menu({ place, byFunction = false }: { place: TopLayerPlace; byFunction?: boolean }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useTopLayer(open, panel, byFunction ? () => anchor.current : anchor, place)
  return (
    <div>
      <button ref={anchor} type="button" onClick={() => setOpen((was) => !was)}>Open</button>
      {open && <div ref={panel} data-testid="panel">Menu</div>}
    </div>
  )
}

test.for([
  ['below-start', { top: '134px', left: '20px' }],
  ['below-end', { top: '134px', right: '1220px' }],
  ['above-start', { bottom: '804px', left: '20px' }],
  ['right-end', { bottom: '770px', left: '228px' }],
] as const)('%s: the panel is in the top layer, fixed beside its control', ([place, at]) => {
  render(<Menu place={place} />)
  fireEvent.click(screen.getByText('Open'))
  const panel = screen.getByTestId('panel')
  expect(shown).toHaveBeenCalledTimes(1)
  expect(panel.getAttribute('popover')).toBe('manual')
  expect(panel.style.position).toBe('fixed')
  expect(panel.style.margin).toBe('0px')
  for (const [side, value] of Object.entries(at)) expect(panel.style.getPropertyValue(side)).toBe(value)
})

test('it follows its control on scroll and resize, and leaves the top layer when the effect is redone', () => {
  const { rerender } = render(<Menu place="below-start" byFunction />)
  fireEvent.click(screen.getByText('Open'))
  const panel = screen.getByTestId('panel')
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ top: 200, bottom: 230, left: 40, right: 240, width: 200, height: 30, x: 40, y: 200, toJSON: () => ({}) })
  act(() => { window.dispatchEvent(new Event('scroll')) })
  expect(panel.style.top).toBe('234px')
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ top: 300, bottom: 330, left: 60, right: 260, width: 200, height: 30, x: 60, y: 300, toJSON: () => ({}) })
  act(() => { window.dispatchEvent(new Event('resize')) })
  expect(panel.style.left).toBe('60px')
  // The anchor given as a function is a new one each render: the panel leaves the top layer and comes back.
  rerender(<Menu place="below-start" byFunction />)
  expect(hidden).toHaveBeenCalled()
  expect(shown.mock.calls.length).toBeGreaterThan(1)
})

test('closed, the panel is gone and nothing is called again; a browser without the Popover API keeps the panel where it is', () => {
  const { unmount } = render(<Menu place="below-start" />)
  fireEvent.click(screen.getByText('Open'))
  fireEvent.click(screen.getByText('Open'))
  expect(screen.queryByTestId('panel')).toBeNull()
  expect(hidden).not.toHaveBeenCalled()
  unmount()
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover
  render(<Menu place="below-start" />)
  fireEvent.click(screen.getByText('Open'))
  expect(screen.getByTestId('panel').getAttribute('popover')).toBeNull()
  expect(screen.getByTestId('panel').style.position).toBe('')
})

// #1349 (production, 20-Nov-2026): a count's peek card from a chip near a side panel's edge ran off the window.
// `below-fit` keeps it in: placeCard's place, in the top layer.
test('below-fit: under its control, and shifted left to stay in the window near the right edge', () => {
  render(<Menu place="below-fit" />)
  fireEvent.click(screen.getByText('Open'))
  const panel = screen.getByTestId('panel')
  expect(panel.getAttribute('popover')).toBe('manual')
  expect([panel.style.left, panel.style.top, panel.style.width, panel.dataset.side]).toEqual(['20px', '136px', '340px', 'below'])
  cleanup()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 400, bottom: 430, left: 1300, right: 1420, width: 120, height: 30, x: 1300, y: 400, toJSON: () => ({}) })
  render(<Menu place="below-fit" />)
  fireEvent.click(screen.getByText('Open'))
  expect(screen.getByTestId('panel').style.left).toBe(`${1440 - 340 - 8}px`)
})
