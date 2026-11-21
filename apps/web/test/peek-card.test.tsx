// #1349: the shared peek card on its own, so every way it opens and closes is proved whichever shard runs it
// (main CI, run 44889661691, measured PeekCard without the record page's tests). Made-up words.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PeekCard } from '@featherbase/shop-floor'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

function show(onClick = vi.fn()) {
  render(
    <PeekCard label="Plants in Bayside" delay={250} trigger={<a href="#plants" onClick={onClick}>3 Plants</a>}>
      <a href="#one">Bayside Supermarket</a>
    </PeekCard>,
  )
  return { chip: screen.getByRole('link', { name: '3 Plants' }), anchor: screen.getByTestId('peek-card-anchor'), onClick }
}
const card = () => screen.queryByRole('dialog', { name: 'Plants in Bayside' })
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

test('the pointer resting on the count opens the card a moment later; leaving closes it', () => {
  const { anchor } = show()
  fireEvent.pointerEnter(anchor, { pointerType: 'mouse' })
  wait(100)
  expect(card()).toBeNull()
  wait(200)
  expect(card()).not.toBeNull()
  fireEvent.pointerLeave(anchor, { pointerType: 'mouse' })
  wait(200)
  expect(card()).toBeNull()
})

test('crossing from the count into the card keeps it open; leaving the card closes it', () => {
  const { anchor } = show()
  fireEvent.pointerEnter(anchor, { pointerType: 'mouse' })
  wait(300)
  fireEvent.pointerLeave(anchor, { pointerType: 'mouse' })
  fireEvent.pointerEnter(card()!)
  wait(300)
  expect(card()).not.toBeNull()
  fireEvent.pointerLeave(card()!)
  wait(200)
  expect(card()).toBeNull()
})

test('focus opens it; Escape closes it, and so does focus leaving for somewhere else', () => {
  const { chip } = show()
  fireEvent.focus(chip)
  wait(300)
  expect(card()).not.toBeNull()
  fireEvent.keyDown(chip, { key: 'Enter' })
  fireEvent.keyDown(chip, { key: 'Escape' })
  wait(10)
  expect(card()).toBeNull()
  fireEvent.keyDown(chip, { key: 'Escape' })
  fireEvent.focus(chip)
  wait(300)
  // Focus moving into the card keeps it; moving away closes it.
  fireEvent.blur(chip, { relatedTarget: screen.getByRole('link', { name: 'Bayside Supermarket' }) })
  wait(10)
  expect(card()).not.toBeNull()
  fireEvent.blur(chip, { relatedTarget: document.body })
  wait(10)
  expect(card()).toBeNull()
})

test("on touch the first tap opens the card instead of following the count; the second is the count's own", () => {
  const { chip, onClick } = show()
  fireEvent.pointerEnter(chip.parentElement!, { pointerType: 'touch' })
  fireEvent.pointerDown(chip, { pointerType: 'touch' })
  fireEvent.click(chip)
  wait(10)
  expect(card()).not.toBeNull()
  expect(onClick).not.toHaveBeenCalled()
  fireEvent.pointerDown(chip, { pointerType: 'touch' })
  fireEvent.click(chip)
  expect(onClick).toHaveBeenCalledTimes(1)
  fireEvent.pointerLeave(chip.parentElement!, { pointerType: 'touch' })
  wait(200)
  expect(card()).not.toBeNull()
})

test('a mouse click is the count\'s own at once', () => {
  const { chip, onClick } = show()
  fireEvent.pointerDown(chip, { pointerType: 'mouse' })
  fireEvent.click(chip)
  expect(onClick).toHaveBeenCalledTimes(1)
})
