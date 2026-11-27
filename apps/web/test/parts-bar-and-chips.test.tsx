// #1419: the shared parts bar and the pressable chips on their own, so their promises hold whichever page uses
// them. Made-up figures.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { ChipButton, ChoiceChip, PartsBar, partsText, type Part } from '@featherbase/shop-floor'

afterEach(cleanup)

const PARTS: Part[] = [
  { label: 'From recent selling', color: 'var(--color-part-recent)', share: 59.6 },
  { label: 'Adjustments', color: 'var(--color-part-adjust)', share: -1 },
]

test('a parts bar says each part’s share in words and draws one piece a part, a negative part as nothing', () => {
  render(<PartsBar parts={PARTS} />)
  const bar = screen.getByRole('img')
  expect(bar).toHaveAccessibleName('From recent selling: 60% · Adjustments: -1%')
  expect(bar).toHaveAttribute('title', partsText(PARTS))
  const pieces = bar.querySelectorAll('i')
  expect(pieces).toHaveLength(2)
  expect((pieces[1] as HTMLElement).style.flex).toBe('0 1 0px')
})

test('as a donut, the same shares are a ring of the part colours', () => {
  render(<PartsBar parts={PARTS} shape="donut" />)
  const donut = screen.getByRole('img')
  expect(donut).toHaveAttribute('data-parts', 'donut')
  expect(donut.style.background).toContain('conic-gradient')
})

test('a chip button is pressed for a quick fill', () => {
  const onClick = vi.fn()
  render(<ChipButton onClick={onClick}>= Last year</ChipButton>)
  fireEvent.click(screen.getByRole('button', { name: '= Last year' }))
  expect(onClick).toHaveBeenCalledOnce()
})

test('a choice chip is picked and unpicked, and says so with aria-pressed', () => {
  function Pick() {
    const [picked, setPicked] = useState(false)
    return <ChoiceChip picked={picked} onToggle={() => setPicked(p => !p)}>Stock arriving</ChoiceChip>
  }
  render(<Pick />)
  const chip = () => screen.getByRole('button', { name: 'Stock arriving' })
  expect(chip()).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(chip())
  expect(chip()).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(chip())
  expect(chip()).toHaveAttribute('aria-pressed', 'false')
})
