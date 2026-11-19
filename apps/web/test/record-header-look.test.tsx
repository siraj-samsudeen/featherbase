// #1348 board 3 (Site record page): the record's header and workspace in the calmer look.
import { render as draw, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { ContentTabs, GroupChip, labelClasses } from '@featherbase/shop-floor'
import { RecordChips } from '../src/components/RecordChips'
import type { TableMeta } from '../src/lib/meta'

const render = (ui: ReactNode) => draw(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

const meta = { name: 'Site', columns: [
  { column_name: 'division', column_type: 'Choice' },
  { column_name: 'status', column_type: 'Choice' },
  { column_name: 'source_system', column_type: 'Choice' },
  { column_name: 'hidden_kind', column_type: 'Choice', hidden: true },
  { column_name: 'code', column_type: 'Data' },
] } as unknown as TableMeta

describe("a record's header", () => {
  test('its status leads its category chips; a source, a hidden field and a blank stay out', () => {
    render(<RecordChips meta={meta} values={{ status: 'Open', division: 'Apparel', source_system: 'SAP', hidden_kind: 'X', code: 'BAY' }} />)
    const chips = within(screen.getByTestId('record-chips')).getAllByText(/./, { selector: '[data-chip]' })
    expect(chips.map((c) => c.textContent)).toEqual(['Open', 'Apparel'])
    expect(chips[0].getAttribute('data-chip')).toBe('green')
  })
  test('with no chip to show, nothing is drawn', () => {
    const { container } = render(<RecordChips meta={meta} values={{ code: 'BAY' }} />)
    expect(container.innerHTML).toBe('')
  })
})

describe("a record's workspace", () => {
  test('the tabs are a quiet track with no underline; the chosen tab is a blue tint', () => {
    render(<ContentTabs label="Record workspace" value="links" onChange={() => {}}
      tabs={[{ id: 'form', label: 'Form', content: null }, { id: 'links', label: 'Links', content: null }]} />)
    expect(screen.getByRole('tablist').className).toMatch(/\bbg-subtle\b/)
    expect(screen.getByRole('tablist').parentElement?.className).not.toMatch(/border-b/)
    expect(screen.getByRole('tab', { name: 'Links' }).className).toMatch(/\bbg-action-tint\b.*\btext-action\b/)
    expect(screen.getByRole('tab', { name: 'Form' }).className).not.toMatch(/border/)
  })
  test('a count chip is a blue tint, never a box', () => {
    render(<GroupChip label="Store Floor" count={4} onSelect={() => {}} />)
    const chip = screen.getByRole('button', { name: /Store Floor/ })
    expect(chip.className).toMatch(/\bbg-action-tint\b/)
    expect(chip.className).not.toMatch(/(?<![\w:\]-])border\b/)
  })
  test('a field label is 13px grey', () => {
    expect(labelClasses()).toMatch(/text-\[13px\].*text-ink-subtle/)
  })
})

test('the chips can sit closer under a pane\'s name', () => {
  render(<RecordChips meta={meta} values={{ status: 'Open' }} className="mt-2" />)
  expect(screen.getByTestId('record-chips').className).toMatch(/\bmt-2\b/)
})
