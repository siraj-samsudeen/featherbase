// #1249: a list's table is never taller than the room left in the window below
// it, so its horizontal scroll bar and the pager stay in view. jsdom has no
// layout, so the page's measurements are given here; the real pixels are the
// verifier's.
import { renderHook } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { useFitToWindow } from '../src/lib/fit-to-window'

afterEach(() => document.body.replaceChildren())

/** A page (<main>) of a given height, scrolled by `scrollTop`, holding a box
 *  `boxTop` px below the window's top, with a pager of `tailHeight` after it. */
function page({ height, top = 50, scrollTop = 0, padBottom = 16, boxTop, tailHeight = 36, tailMargin = 12, withMain = true }: {
  height: number; top?: number; scrollTop?: number; padBottom?: number; boxTop: number; tailHeight?: number; tailMargin?: number; withMain?: boolean
}) {
  const main = document.createElement(withMain ? 'main' : 'div')
  Object.defineProperty(main, 'clientHeight', { value: height })
  Object.defineProperty(main, 'scrollTop', { value: scrollTop })
  main.style.paddingBottom = `${padBottom}px`
  main.getBoundingClientRect = () => ({ top } as DOMRect)
  const wrapper = document.createElement('div')
  const box = document.createElement('div')
  box.getBoundingClientRect = () => ({ top: boxTop } as DOMRect)
  wrapper.append(box)
  const tail = document.createElement('div')
  tail.style.marginTop = `${tailMargin}px`
  tail.getBoundingClientRect = () => ({ height: tailHeight } as DOMRect)
  main.append(wrapper, tail)
  document.body.append(main)
  return box
}

test('the box ends where the pager still fits above the bottom of the page', () => {
  // Box 118px into an 849px page (169 - 51): 849 - 118 - (36 + 12) - 16 = 667.
  const box = page({ height: 849, top: 51, boxTop: 169 })
  renderHook(() => useFitToWindow(box))
  expect(box.style.maxHeight).toBe('667px')
})

test('the room is measured from where the box sits at rest, however far the page is scrolled', () => {
  // Scrolled down 100px, the box is drawn 100px higher; its place at rest is the same.
  const box = page({ height: 849, top: 51, scrollTop: 100, boxTop: 69 })
  renderHook(() => useFitToWindow(box))
  expect(box.style.maxHeight).toBe('667px')
})

test('on a very short window the box keeps a usable height', () => {
  const box = page({ height: 300, boxTop: 260 })
  renderHook(() => useFitToWindow(box))
  expect(box.style.maxHeight).toBe('240px')
})

test('a box with nothing after it uses the room to the page bottom', () => {
  const box = page({ height: 600, top: 0, boxTop: 100, tailHeight: 0, tailMargin: 0 })
  box.parentElement!.nextElementSibling!.remove()
  renderHook(() => useFitToWindow(box))
  expect(box.style.maxHeight).toBe(`${600 - 100 - 16}px`)
})

test('outside a <main> the window is the page', () => {
  const box = page({ height: 0, boxTop: 100, withMain: false })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 700 })
  renderHook(() => useFitToWindow(box))
  // 700 - 100 - (36 + 12) - the document's own padding (none).
  expect(box.style.maxHeight).toBe('552px')
})

test('the cap goes when the list does, and a window resize measures again', () => {
  let boxTop = 169
  const box = page({ height: 849, top: 51, boxTop })
  box.getBoundingClientRect = () => ({ top: boxTop } as DOMRect)
  const { unmount } = renderHook(() => useFitToWindow(box))
  boxTop = 269
  window.dispatchEvent(new Event('resize'))
  expect(box.style.maxHeight).toBe('567px')
  unmount()
  expect(box.style.maxHeight).toBe('')
})

test('no box, nothing to fit', () => {
  expect(() => renderHook(() => useFitToWindow(null))).not.toThrow()
})
