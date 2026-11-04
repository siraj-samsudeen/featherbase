// The presentational pieces relational navigation composes (#910, D6): plain
// props and callbacks, no Table metadata, no server.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { PanePlace, resolvePanePlace, ViewToggle } from '@featherbase/shop-floor'

describe('ViewToggle', () => {
  test('marks the chosen view as pressed and reports a change', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ViewToggle value="table" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'Compact' }))
    expect(onChange).toHaveBeenCalledWith('compact')
  })
})

describe('PanePlace', () => {
  test('auto names the place it resolved to', () => {
    render(<PanePlace value="auto" resolved="bottom" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Auto (bottom)' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('choosing a place reports it', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<PanePlace value="auto" resolved="right" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Bottom' }))
    expect(onChange).toHaveBeenCalledWith('bottom')
  })

  test.each([
    [1199, 'bottom'],
    [1200, 'right'],
  ] as const)('auto at %ipx places the pane at the %s', (width, place) => {
    expect(resolvePanePlace('auto', width)).toBe(place)
  })

  test('a chosen place ignores the width', () => {
    expect(resolvePanePlace('bottom', 1600)).toBe('bottom')
  })
})
