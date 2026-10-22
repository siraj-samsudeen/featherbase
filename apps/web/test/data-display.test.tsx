// DataList, Headline and the readable amount helpers (#380 stage 1c).
// Pure tests: no server, no database.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { achievementTone, DataList, Headline, type DataColumn } from '../src/components/ui'
import { fmtCount, fmtINR } from '../src/lib/inr'

describe('fmtINR — the readable lakh/crore ladder (ADR 750)', () => {
  test.each([
    [850, '₹850'],
    [45_600, '₹45,600'],
    [99_999.6, '₹1.00 L'], // rounds up into the next rung, never "₹1,00,000"
    [1_21_000, '₹1.21 L'],
    [2_48_499, '₹2.48 L'],
    [99_99_999, '₹1.00 Cr'], // 99.99… lakh is a crore, never "₹100.00 L"
    [9_99_99_999, '₹10.00 Cr'],
    [1_74_00_000, '₹1.74 Cr'],
    [12_34_56_79_00_000, '₹1,23,456.79 Cr'], // a thousand crore and up keeps Indian grouping
    [-72_000, '-₹72,000'],
    [0, '₹0'],
  ])('%d reads %s', (value, text) => {
    expect(fmtINR(value)).toBe(text)
  })

  test('signed shows the direction both ways', () => {
    expect(fmtINR(4_000, { signed: true })).toBe('+₹4,000')
    expect(fmtINR(-41_000, { signed: true })).toBe('-₹41,000')
    expect(fmtINR(0, { signed: true })).toBe('₹0')
  })

  test('a missing amount is a dash, never ₹0', () => {
    expect(fmtINR(null)).toBe('—')
    expect(fmtINR(undefined)).toBe('—')
    expect(fmtINR(Number.NaN)).toBe('—')
  })
})

describe('fmtCount', () => {
  test('groups the Indian way, with no unit and no ₹', () => {
    expect(fmtCount(1_13_016)).toBe('1,13,016')
    expect(fmtCount(1234567)).toBe('12,34,567')
    expect(fmtCount(12.5, 1)).toBe('12.5')
    expect(fmtCount(null)).toBe('—')
  })

  test('rounds before formatting and never shows a negative zero', () => {
    expect(fmtCount(-0.4)).toBe('0')
    expect(fmtCount(2.6)).toBe('3')
    expect(fmtCount(-0.04, 1)).toBe('0')
  })
})

interface Run {
  id: string
  name: string
  day: string
  done: number
  total: number
  status: string
}
const runs: Run[] = [
  { id: 'r1', name: 'Opening checklist', day: '22-Oct-2026', done: 14, total: 18, status: 'In progress' },
  { id: 'r2', name: 'Cash count', day: '21-Oct-2026', done: 3, total: 5, status: 'Overdue' },
]
const columns: DataColumn<Run>[] = [
  { key: 'name', header: 'Checklist', cell: (r) => r.name, phone: 'title' },
  { key: 'day', header: 'Date', cell: (r) => r.day, phone: 'meta' },
  { key: 'done', header: 'Done', cell: (r) => `${r.done} of ${r.total}`, align: 'end', phone: 'value' },
  { key: 'status', header: 'Status', cell: (r) => r.status, phone: 'status' },
  { key: 'id', header: 'Row ID', cell: (r) => r.id, phone: 'hidden' },
]

describe('DataList', () => {
  test('on a wide screen it is a table named by its caption, numbers aligned to the end', () => {
    render(<DataList layout="table" caption="Checklist runs" rows={runs} columns={columns} rowKey={(r) => r.id} />)
    const table = screen.getByRole('table', { name: 'Checklist runs' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Checklist', 'Date', 'Done', 'Status', 'Row ID'])
    expect(within(table).getByRole('cell', { name: '14 of 18' }).className).toMatch(/\btext-right\b/)
  })

  test('a table too wide for the screen scrolls by keyboard, and each row is named by its first cell', () => {
    render(<DataList layout="table" caption="Checklist runs" rows={runs} columns={columns} rowKey={(r) => r.id} />)
    const scroller = screen.getByRole('region', { name: 'Checklist runs' })
    expect(scroller).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('rowheader', { name: 'Opening checklist' })).toHaveAttribute('scope', 'row')
  })

  test('row text uses the density size, so it is 16px on a touch screen at any width', () => {
    const { container } = render(<DataList layout="table" caption="Checklist runs" rows={runs} columns={columns} rowKey={(r) => r.id} />)
    expect(container.querySelector('table')?.className).toMatch(/\btext-control\b/)
    render(<DataList layout="cards" caption="Runs as cards" rows={runs} columns={columns} rowKey={(r) => r.id} />)
    expect(screen.getByRole('list', { name: 'Runs as cards' }).className).toMatch(/\btext-control\b/)
  })

  test('a failed load offers a retry', async () => {
    const retry = vi.fn()
    render(<DataList state="error" error="Cannot load rows" onRetry={retry} caption="Checklist runs" rows={[]} columns={columns} rowKey={(r) => r.id} />)
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  test('on a phone each row is a card: title, status and date first, figures labelled, hidden columns left out', () => {
    render(<DataList layout="cards" caption="Checklist runs" rows={runs} columns={columns} rowKey={(r) => r.id} />)
    const list = screen.getByRole('list', { name: 'Checklist runs' })
    const cards = within(list).getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    const first = within(cards[0])
    expect(first.getByText('Opening checklist')).toBeInTheDocument()
    expect(first.getByText('In progress')).toBeInTheDocument()
    expect(first.getByText('22-Oct-2026')).toBeInTheDocument()
    // A figure on a card carries its column name, since there is no header row.
    expect(first.getByText('Done').nextElementSibling).toHaveTextContent('14 of 18')
    expect(first.queryByText('r1')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('with no rows it says so and offers the way forward, instead of an empty table', () => {
    render(
      <DataList
        caption="Checklist runs"
        rows={[]}
        columns={columns}
        rowKey={(r) => r.id}
        empty={{ title: 'No checklists yet', action: <button type="button">Start a checklist</button> }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'No checklists yet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start a checklist' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('while loading it announces the list it is loading', () => {
    render(<DataList state="loading" caption="Checklist runs" rows={[]} columns={columns} rowKey={(r) => r.id} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading checklist runs')
  })

  test('a failed load is an alert, never an empty list', () => {
    render(
      <DataList state="error" error="Cannot load rows for Checklist" caption="Checklist runs" rows={[]} columns={columns} rowKey={(r) => r.id} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot load rows for Checklist')
    expect(screen.queryByText('No rows yet')).toBeNull()
  })
})

describe('Headline', () => {
  test('leads with the conclusion and a meter of progress that says its value in words', () => {
    render(
      <Headline
        label="Month to date · 01-Oct-2026 to 21-Oct-2026"
        conclusion="₹72,000 behind"
        tone="negative"
        detail="81.7% of target: ₹3.21 L sold of ₹3.93 L"
        progress={{ value: 81.7, marker: 90, label: 'Achievement' }}
      />,
    )
    const region = screen.getByRole('region', { name: '₹72,000 behind' })
    expect(within(region).getByText('₹72,000 behind').className).toMatch(/\btext-negative\b/)
    const meter = within(region).getByRole('meter', { name: 'Achievement' })
    expect(meter).toHaveAttribute('aria-valuenow', '81.7')
    expect(meter).toHaveAttribute('aria-valuetext', '81.7%')
    // The empty part of the track has an edge a reader can see (3:1), not only a faint fill.
    expect(meter.className).toMatch(/\bborder-border-control\b/)
  })

  test('the meter says its value the way the page shows it', () => {
    render(<Headline label="Month" conclusion="Nearly there" progress={{ value: 1234.56, label: 'Achievement' }} />)
    expect(screen.getByRole('meter', { name: 'Achievement' })).toHaveAttribute('aria-valuetext', '1,234.6%')
  })

  test('progress beyond 100% stays a valid meter', () => {
    render(<Headline label="Yesterday" conclusion="₹4,000 ahead" tone="positive" progress={{ value: 120, label: 'Achievement' }} />)
    const meter = screen.getByRole('meter', { name: 'Achievement' })
    expect(Number(meter.getAttribute('aria-valuemax'))).toBeGreaterThanOrEqual(120)
  })
})

describe('achievementTone — the bands of the sales-target legend', () => {
  test.each([
    [62.4, 'negative'],
    [89.94, 'negative'], // shown as 89.9%
    [90, 'caution'],
    [99.9, 'caution'],
    [89.96, 'caution'], // shown as 90%, so it reads as the 90% band, not below it
    [99.96, 'positive'], // shown as 100%
    [100, 'positive'],
    [126.2, 'positive'],
    [null, 'missing'],
  ] as const)('%s%% is %s', (pct, tone) => {
    expect(achievementTone(pct)).toBe(tone)
  })
})
