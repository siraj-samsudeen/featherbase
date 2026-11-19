// #1282 F1–F6: the Grid (shared, shop-floor): rows × columns, a cell stepping through its
// values, changes waiting outlined until saved, a plain sentence on hover, read-only for
// someone who may not change it; and the dark pending bar.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Grid, PendingBar, type GridColumn, type GridRow } from '@featherbase/shop-floor'

afterEach(cleanup)

const STEPS = [{ value: 'Own', label: 'Own' }, { value: 'Team', label: 'Team' }, { value: 'Area', label: 'Area' }, { value: 'All', label: 'All' }]
const ROWS: GridRow[] = [
  { id: 'v', group: 'Dash', title: 'View Reports · Reader' },
  { id: 'e', group: 'Dash', title: 'Edit Sections · Manager' },
  { id: 't', group: 'Tasker', title: 'Edit Tasks · Manager' },
]
const columns = (n: number): GridColumn[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, label: `Role ${i}`, header: <a href={`#r${i}`}>Role {i}</a> }))
const SAVED: Record<string, string> = { 'v|r0': 'Own', 'e|r1': 'Area' }

function grid({ n = 3, waiting = new Map<string, string | null>(), readOnly = false } = {}) {
  const onStep = vi.fn()
  render(<Grid label="What each role can do" rows={ROWS} columns={columns(n)} steps={STEPS} readOnly={readOnly}
    saved={(row, column) => SAVED[`${row.id}|${column.id}`] ?? null} waiting={waiting} onStep={onStep}
    tooltip={(row, column, value) => `${column.label} ${value ? `can ${row.title} (${value})` : `cannot ${row.title}`}`} />)
  return { onStep }
}
const cell = (row: string, column: string) => screen.getByTestId(`grid-cell-${row}-${column}`)

describe('the Grid', () => {
  test('groups its rows under each group, titles them in plain words, and heads each column with its link', () => {
    grid()
    const table = screen.getByRole('table', { name: 'What each role can do' })
    expect(within(table).getAllByTestId('grid-group').map((g) => g.textContent)).toEqual(['Dash', 'Tasker'])
    expect(within(table).getAllByTestId('grid-row-title').map((t) => t.textContent)).toEqual(['View Reports · Reader', 'Edit Sections · Manager', 'Edit Tasks · Manager'])
    expect(within(table).getAllByRole('columnheader').slice(1).map((h) => within(h).getByRole('link').textContent)).toEqual(['Role 0', 'Role 1', 'Role 2'])
  })

  test('each header heads its own column: the cells under it are its cells', () => {
    grid()
    const headers = screen.getAllByRole('columnheader')
    const firstRow = screen.getAllByRole('row').find((r) => within(r).queryByTestId('grid-row-title'))!
    // The title column, then one cell per column, in the header's order.
    expect(within(firstRow).getAllByRole('cell').map((c) => c.getAttribute('data-column'))).toEqual(['', 'r0', 'r1', 'r2'])
    expect(headers.map((h) => h.getAttribute('data-column'))).toEqual(['', 'r0', 'r1', 'r2'])
  })

  test('headers lie flat up to ten columns, and tilt beyond that', () => {
    grid({ n: 10 })
    expect(screen.getAllByTestId('grid-header').every((h) => h.dataset.tilt === 'flat')).toBe(true)
    cleanup()
    grid({ n: 11 })
    expect(screen.getAllByTestId('grid-header').every((h) => h.dataset.tilt === 'tilted')).toBe(true)
  })

  test('a cell steps — → Own → Team → Area → All → —, saying the step it would take', () => {
    const { onStep } = grid()
    fireEvent.click(within(cell('v', 'r2')).getByRole('button'))
    expect(onStep).toHaveBeenLastCalledWith(ROWS[0], expect.objectContaining({ id: 'r2' }), 'Own')
    fireEvent.click(within(cell('e', 'r1')).getByRole('button'))
    expect(onStep).toHaveBeenLastCalledWith(ROWS[1], expect.objectContaining({ id: 'r1' }), 'All')
    cleanup()
    const again = grid({ waiting: new Map([['e|r1', 'All']]) })
    fireEvent.click(within(cell('e', 'r1')).getByRole('button'))
    expect(again.onStep).toHaveBeenLastCalledWith(ROWS[1], expect.objectContaining({ id: 'r1' }), null)
  })

  test('a change waiting shows its new value, outlined, and every cell says its sentence on hover', () => {
    grid({ waiting: new Map([['v|r2', 'Team'], ['v|r0', null]]) })
    expect([cell('v', 'r2').textContent, cell('v', 'r2').dataset.waiting, cell('v', 'r0').textContent, cell('e', 'r1').dataset.waiting]).toEqual(['Team', 'true', '—', 'false'])
    expect(within(cell('e', 'r1')).getByRole('button')).toHaveAttribute('title', 'Role 1 can Edit Sections · Manager (Area)')
    expect(within(cell('t', 'r0')).getByRole('button')).toHaveAttribute('title', 'Role 0 cannot Edit Tasks · Manager')
  })

  test('read-only, the same values with their sentences, and nothing to step', () => {
    grid({ readOnly: true })
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(cell('e', 'r1')).toHaveTextContent('Area')
    expect(within(cell('e', 'r1')).getByText('Area')).toHaveAttribute('title', 'Role 1 can Edit Sections · Manager (Area)')
  })
})

describe('the pending bar', () => {
  test('says how many changes wait and about how many people they touch; Discard and Review and save', () => {
    const onDiscard = vi.fn()
    const onReview = vi.fn()
    render(<PendingBar count={2} people={8} onDiscard={onDiscard} onReview={onReview} />)
    expect(screen.getByTestId('pending-bar')).toHaveTextContent('2 changes waiting · affects about 8 people')
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review and save' }))
    expect([onDiscard.mock.calls.length, onReview.mock.calls.length]).toEqual([1, 1])
  })

  test('one change touching one person says so in the singular', () => {
    render(<PendingBar count={1} people={1} onDiscard={() => {}} onReview={() => {}} />)
    expect(screen.getByTestId('pending-bar')).toHaveTextContent('1 change waiting · affects about 1 person')
  })
})
