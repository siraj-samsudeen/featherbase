// DataList, Headline and the readable amount helpers (#380 stage 1c).
// Pure tests: no server, no database.

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { achievementTone, DataList, Headline, type DataColumn } from '../src/components/ui'
import { fmtCount, fmtDay, fmtINR, fmtNumber } from '../src/lib/inr'
import { formatNumber } from '../src/lib/settings'
import { pageRange } from '../src/components/ListView'

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

describe('fmtNumber — Float and Currency list cells', () => {
  test('groups the Indian way at the configured precision, above a lakh where the two systems differ', () => {
    expect(fmtNumber(1234567.5, 2)).toBe('12,34,567.50')
    expect(fmtNumber(-98765432.1, 1)).toBe('-9,87,65,432.1')
    expect(fmtNumber(1234.5, 2)).toBe('1,234.50') // under a lakh, the same as western grouping
  })

  test('list cells use it: formatNumber of 1234567.5 at precision 2 is 12,34,567.50', () => {
    expect(formatNumber(1234567.5, 2)).toBe('12,34,567.50')
    expect(formatNumber('', 2)).toBe('')
  })
})

describe('fmtDay — dates read from a spreadsheet', () => {
  test.each([
    [new Date(2026, 9, 21), '21-Oct-2026'],
    [new Date(2026, 0, 1), '01-Jan-2026'], // month is zero-based in Date: no off-by-one
    [new Date(2025, 11, 31, 23, 59), '31-Dec-2025'], // the local day, even late in the evening
  ])('%s reads %s', (d, text) => {
    expect(fmtDay(d)).toBe(text)
  })
})

describe('list counts', () => {
  test('the pager groups a lakh-scale table the Indian way', () => {
    expect(pageRange(0, 20, 123456)).toBe('1–20 of 1,23,456')
    expect(pageRange(123440, 20, 123456)).toBe('1,23,441–1,23,456 of 1,23,456')
    expect(pageRange(0, 20, 0)).toBe('0–0 of 0')
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

const EMPTY = { title: 'No checklists yet', body: 'Runs you start appear here.' }

describe('DataList', () => {
  test('an empty state with a way forward is required, not a bare "no rows"', () => {
    // @ts-expect-error — omitting the empty state is a type error
    render(<DataList caption="A" rows={runs} columns={columns} rowKey={(r) => r.id} />)
    // @ts-expect-error — a title alone gives no explanation or way forward
    render(<DataList caption="B" rows={runs} columns={columns} rowKey={(r) => r.id} empty={{ title: 'Nothing' }} />)
  })

  test('on a wide screen it is a table named by its caption, numbers aligned to the end', () => {
    render(<DataList layout="table" caption="Checklist runs" rows={runs} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />)
    const table = screen.getByRole('table', { name: 'Checklist runs' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Checklist', 'Date', 'Done', 'Status', 'Row ID'])
    expect(within(table).getByRole('cell', { name: '14 of 18' }).className).toMatch(/\btext-right\b/)
  })

  test('a table too wide for the screen scrolls by keyboard, and each row is named by its first cell', () => {
    render(<DataList layout="table" caption="Checklist runs" rows={runs} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />)
    const scroller = screen.getByRole('region', { name: 'Checklist runs' })
    expect(scroller).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('rowheader', { name: 'Opening checklist' })).toHaveAttribute('scope', 'row')
  })

  test('row text uses the density size, so it is 16px on a touch screen at any width', () => {
    const { container } = render(<DataList layout="table" caption="Checklist runs" rows={runs} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />)
    expect(container.querySelector('table')?.className).toMatch(/\btext-control\b/)
    render(<DataList layout="cards" caption="Runs as cards" rows={runs} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />)
    expect(screen.getByRole('list', { name: 'Runs as cards' }).className).toMatch(/\btext-control\b/)
  })

  test('a failed load offers a retry', async () => {
    const retry = vi.fn()
    render(<DataList state="error" error="Cannot load rows" onRetry={retry} caption="Checklist runs" rows={[]} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />)
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  test('on a phone each row is a card: title, status and date first, figures labelled, hidden columns left out', () => {
    render(<DataList layout="cards" caption="Checklist runs" rows={runs} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />)
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

  test('a long unbroken value wraps inside its card instead of widening the page', () => {
    const long = [{ ...runs[0], name: 'SKU-0123456789012345678901234567890123456789', done: 1 }]
    render(<DataList layout="cards" caption="Runs" rows={long} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />)
    const card = screen.getByRole('listitem')
    // jsdom does no layout, so pin the two CSS facts that keep the grid inside the card.
    expect(card.querySelector('dl')?.className).toMatch(/grid-cols-\[fit-content\(50%\)_minmax\(0,1fr\)\]/)
    expect(within(card).getByText('Done').nextElementSibling?.className).toMatch(/\bwrap-anywhere\b/)
    expect(within(card).getByText(long[0].name).className).toMatch(/\bwrap-anywhere\b/)
  })

  test('a status too wide for the card moves under the title and wraps, never past the edge', () => {
    const wordy = [{ ...runs[0], status: 'Awaiting second-level approval from the regional office' }]
    render(<DataList layout="cards" caption="Runs" rows={wordy} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />)
    const status = within(screen.getByRole('listitem')).getByText(wordy[0].status) // the cell is plain text, so this is the status area itself
    expect(status.parentElement?.className).toMatch(/\bflex-wrap\b/) // header wraps
    expect(status.className).not.toMatch(/\bshrink-0\b/)
    expect(status.className).toMatch(/\bmax-w-full\b/)
    expect(status.className).toContain('[&_*]:whitespace-normal') // even inside a nowrap pill
  })

  test('every part of a phone card wraps inside it: title, status, meta, labels and values', () => {
    const LONG = 'X'.repeat(80)
    const cols: DataColumn<Run>[] = [
      { key: 'name', header: 'Checklist', cell: () => LONG, phone: 'title' },
      { key: 'status', header: 'Status', cell: () => <span className="whitespace-nowrap">{LONG}</span>, phone: 'status' },
      { key: 'day', header: 'Date', cell: () => <span className="whitespace-nowrap">{LONG}</span>, phone: 'meta' },
      { key: 'done', header: `Label${LONG}`, cell: () => LONG, phone: 'value' },
    ]
    render(<DataList layout="cards" caption="Runs" rows={[runs[0]]} columns={cols} rowKey={(r) => r.id} empty={EMPTY} />)
    const card = screen.getByRole('listitem')
    // jsdom does no layout: pin the CSS that keeps every role inside the card.
    expect(card.className).toMatch(/\bmin-w-0\b/)
    expect(card.className).toMatch(/\bwrap-anywhere\b/) // inherited by every descendant
    expect(card.className).toContain('[&_*]:whitespace-normal') // beats nowrap children
    expect(card.querySelector('dl')?.className).toContain('grid-cols-[fit-content(50%)_minmax(0,1fr)]') // a label never takes more than half
    expect(card.querySelector('dt')?.className).toMatch(/\bmin-w-0\b/)
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
    render(<DataList state="loading" caption="Checklist runs" rows={[]} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading checklist runs')
  })

  test('a failed load is an alert, never an empty list', () => {
    render(
      <DataList state="error" error="Cannot load rows for Checklist" caption="Checklist runs" rows={[]} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot load rows for Checklist')
    expect(screen.queryByText('No rows yet')).toBeNull()
  })
})

describe('DataList picks its shape from the screen width by default', () => {
  const real = window.matchMedia
  afterEach(() => {
    window.matchMedia = real
  })

  /** A controllable matchMedia: `narrow` decides whether the 40rem query matches. */
  function fakeScreen(narrow: boolean) {
    const listeners = new Set<() => void>()
    const mql = {
      get matches() {
        return narrow
      },
      media: '',
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }
    window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia
    return {
      resize(toNarrow: boolean) {
        narrow = toNarrow
        listeners.forEach((fn) => fn())
      },
    }
  }

  test('a narrow screen gets cards and a wide one a table', () => {
    fakeScreen(true)
    const { unmount } = render(<DataList caption="Runs" rows={runs} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />)
    expect(screen.getByRole('list', { name: 'Runs' })).toBeInTheDocument()
    expect(window.matchMedia).toHaveBeenCalledWith('(width < 40rem)')
    unmount()
    fakeScreen(false)
    render(<DataList caption="Runs" rows={runs} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />)
    expect(screen.getByRole('table', { name: 'Runs' })).toBeInTheDocument()
  })

  test('turning a phone or narrowing a window switches the shape live', () => {
    const screenSize = fakeScreen(false)
    render(<DataList caption="Runs" rows={runs} columns={columns} rowKey={(r) => r.id} empty={EMPTY} />)
    expect(screen.getByRole('table', { name: 'Runs' })).toBeInTheDocument()
    act(() => screenSize.resize(true))
    expect(screen.getByRole('list', { name: 'Runs' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
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

  test('past 100% the marker moves with the scale, so it still sits at the value it names', () => {
    render(<Headline label="Month" conclusion="₹4,000 ahead" tone="positive" progress={{ value: 120, marker: 90, label: 'Achievement' }} />)
    const marker = screen.getByRole('meter', { name: 'Achievement' }).querySelector('[aria-hidden="true"]') as HTMLElement
    expect(marker.style.left).toBe('75%') // 90 on a 0–120 scale
  })

  test('a negative achievement (returns beat sales) stays a valid meter and still says its signed value', () => {
    render(<Headline label="Month" conclusion="₹2,000 behind" tone="negative" progress={{ value: -12.5, label: 'Achievement' }} />)
    const meter = screen.getByRole('meter', { name: 'Achievement' })
    expect(meter).toHaveAttribute('aria-valuenow', '0')
    expect(meter).toHaveAttribute('aria-valuetext', '-12.5%')
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
