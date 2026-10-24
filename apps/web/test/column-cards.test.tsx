// The table builder's cards view: the column-type chips are the main control,
// so they must be thumb-sized on a phone and say which one is chosen in more
// than colour (#380, usable-on-any-device).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ColumnCards } from '../src/components/ColumnCards'

function renderCards() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  const column = { column_name: 'name', label: 'Name', column_type: 'Data', target: '', reqd: false, in_list_view: true, source_index: null }
  render(
    <QueryClientProvider client={client}>
      <ColumnCards columns={[column]} verdicts={[null]} onPatch={vi.fn()} onRemove={vi.fn()} onAdd={vi.fn()} />
    </QueryClientProvider>,
  )
}

test('type chips take the touch-sized control height', () => {
  renderCards()
  expect(screen.getByRole('button', { name: 'Number' }).className).toMatch(/\bmin-h-control\b/)
})

test('the chosen type is announced as pressed, not shown by colour alone', () => {
  renderCards()
  expect(screen.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Number' })).toHaveAttribute('aria-pressed', 'false')
})
