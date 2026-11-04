// The presentational pieces relational navigation composes (#910, D6): plain
// props and callbacks, no Table metadata, no server.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { GroupChip, LinkChip, PanePlace, resolvePanePlace, ViewToggle } from '@featherbase/shop-floor'

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

describe('LinkChip', () => {
  test('reads name first, then the code', () => {
    render(<LinkChip label="North bay" code="B-104" onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: 'North bay · B-104' })).toBeInTheDocument()
  })

  test('opening the label reports it', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<LinkChip label="North bay" onOpen={onOpen} />)
    await user.click(screen.getByRole('button', { name: 'North bay' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  test('go there and filter are their own actions', async () => {
    const onGoThere = vi.fn()
    const onFilter = vi.fn()
    const user = userEvent.setup()
    render(<LinkChip label="North bay" onGoThere={onGoThere} onFilter={onFilter} />)
    await user.click(screen.getByRole('button', { name: 'Go there' }))
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    expect([onGoThere.mock.calls.length, onFilter.mock.calls.length]).toEqual([1, 1])
  })

  test('a disabled filter says why', () => {
    render(<LinkChip label="North bay" onFilter={() => {}} filterDisabledReason="This list has no Bay column" />)
    const filter = screen.getByRole('button', { name: 'Filter' })
    expect(filter).toBeDisabled()
    expect(filter).toHaveAccessibleDescription('This list has no Bay column')
  })

  test('a row the viewer cannot read shows neither its name nor its code nor any action', () => {
    render(<LinkChip label="Secret bay" code="B-999" unreadable onOpen={() => {}} onGoThere={() => {}} onFilter={() => {}} />)
    expect(screen.getByText('Not visible to you')).toBeInTheDocument()
    expect(screen.queryByText(/Secret bay|B-999/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('GroupChip', () => {
  test('shows its label and Indian-grouped count, pressed when selected', () => {
    render(<GroupChip label="Shelf" count={125000} selected onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Shelf 1,25,000' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('selecting reports it', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<GroupChip label="Shelf" count={3} onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: 'Shelf 3' }))
    expect(onSelect).toHaveBeenCalledOnce()
  })
})
