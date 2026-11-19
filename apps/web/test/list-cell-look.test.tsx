// #1348 board 2 (Site list): what a list cell draws. A status is a chip with its dot, a category a tinted chip,
// a source the shared tag, a code small mono grey, a yes/no muted words, and an empty field nothing at all.
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, test } from 'vitest'
import { RowDensityContext } from '@featherbase/shop-floor'
import { ListCell } from '../src/components/ListRows'
import type { ListColumn } from '../src/lib/list-view-columns'

const col = (column_name: string, column_type: string): ListColumn => ({ column_name, column_type, label: column_name } as ListColumn)
const draw = (name: string, type: string, value: unknown, compact = false) => render(
  <QueryClientProvider client={new QueryClient()}><RowDensityContext.Provider value={compact ? 'compact' : 'comfortable'}>
    <ListCell row={{ row_id: 'r1', [name]: value }} col={col(name, type)} table="Site" settings={{}} first={false} />
  </RowDensityContext.Provider></QueryClientProvider>,
).container.querySelector(`[data-testid="cell-${name}"]`) as HTMLElement

describe('a list cell in the calmer look', () => {
  test('a status is a green chip with its dot; Compact Rows drops the dot', () => {
    expect(draw('status', 'Choice', 'Open').querySelector('[data-chip="green"] [data-chip-dot]')).not.toBeNull()
    expect(draw('status', 'Choice', 'Open', true).querySelector('[data-chip="green"] [data-chip-dot]')).toBeNull()
  })
  test('a source is the shared tag, not a category tint', () => {
    const cell = draw('source_system', 'Choice', 'SAP')
    expect(cell.querySelector('[data-chip]')).toBeNull()
    expect(screen.getByText('SAP').className).toMatch(/\bbg-tag\b/)
  })
  test('a code is small mono grey, never blue', () => {
    expect(draw('code', 'Data', 'BAY').querySelector('span')?.className).toMatch(/font-mono.*text-ink-subtle/)
  })
  test('a yes/no reads Yes or No in muted grey', () => {
    const cell = draw('store', 'Check', true)
    expect(cell.textContent).toBe('Yes')
    expect(cell.className).toMatch(/\btext-ink-subtle\b/)
  })
  test('an empty field stays blank: no dash', () => {
    expect(draw('postal_code', 'Data', '').textContent).toBe('')
    expect(draw('opened_on', 'Date', null).textContent).toBe('')
  })
})
