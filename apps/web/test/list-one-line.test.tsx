// A list's one-line cells and its "more columns" hint (#1019). jsdom lays
// nothing out, so each test gives the boxes the sizes a browser would.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MoreColumnsHint, OneLine } from '../src/components/list-one-line'

const sizes = ['clientWidth', 'scrollWidth'].map((name) => [name, Object.getOwnPropertyDescriptor(Element.prototype, name)!] as const)
afterEach(() => { for (const [name, descriptor] of sizes) Object.defineProperty(Element.prototype, name, descriptor) })

/** Every box `shown` wide, holding `needs` of content. */
function laidOut(shown: number, needs: number) {
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => shown })
  Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get: () => needs })
}

test('hovering a clipped value shows its whole text as a tooltip', () => {
  laidOut(100, 300)
  render(<OneLine>Harbour Road Supermarket, Kochi</OneLine>)
  const cell = screen.getByText('Harbour Road Supermarket, Kochi')
  fireEvent.mouseEnter(cell)
  expect(cell).toHaveAttribute('title', 'Harbour Road Supermarket, Kochi')
})

test('hovering a value that fits shows no tooltip repeating it', () => {
  laidOut(300, 100)
  render(<OneLine>Kochi</OneLine>)
  const cell = screen.getByText('Kochi')
  fireEvent.mouseEnter(cell)
  expect(cell).not.toHaveAttribute('title')
})

test('Show more columns scrolls the list most of its width to the right', () => {
  const box = document.createElement('div')
  Object.defineProperty(box, 'clientWidth', { value: 500 })
  box.scrollBy = vi.fn()
  render(<MoreColumnsHint box={box} />)
  fireEvent.click(screen.getByRole('button', { name: 'Show more columns' }))
  expect(box.scrollBy).toHaveBeenCalledWith({ left: 300, behavior: 'smooth' })
})
