// A report asked for in the chat, drawn on the page by React in a DOM. Made-up figures.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { openDom } from './test-dom'

vi.mock('../../../../packages/shop-floor/node_modules/lucide-react', async importOriginal =>
  Object.fromEntries(Object.keys(await importOriginal<object>()).map(name => [name, () => null])))

let closeDom: () => void = () => {}
beforeAll(() => { closeDom = openDom() })
afterAll(() => closeDom())

const find = (testid: string) => document.querySelector(`[data-testid="${testid}"]`)
const result = {
  truncated: false, at: '2026-11-15T00:19:00.000Z', asOf: '2026-11-14', places: ['9901'],
  columns: [{ name: 'subcategory', kind: 'dimension' as const }, { name: 'target', kind: 'measure' as const, definition: 'sum of target' },
    { name: 'gap', kind: 'metric' as const, definition: 'sales - target' }],
  rows: [['Silk sarees', 1250000.49, -240000]],
}
let unmount: () => void = () => {}
async function draw(report: Record<string, unknown>, onClose = () => {}) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ReportAnswer } = await import('./ask-panel')
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  await act(async () => { root.render(<ReportAnswer report={report as never} onClose={onClose} />) })
  unmount = () => { act(() => root.unmount()); container.remove() }
  return { act, container }
}
afterEach(() => unmount())

describe('a report on the page', () => {
  it('is headed by its question and drawn as the report draws its figures, with how they were worked out', async () => {
    const { container } = await draw({ question: 'Which subcategories are furthest behind target?', plan: { measures: ['gap'] }, result })
    const drawn = find('report-answer')!
    expect(drawn.querySelector('h2')!.textContent).toBe('Which subcategories are furthest behind target?')
    expect([...drawn.querySelectorAll('thead th')].map(cell => cell.textContent)).toEqual(['Subcategory', 'Target', 'Gap'])
    expect([...drawn.querySelectorAll('tbody tr > *')].map(cell => cell.textContent)).toEqual(['Silk sarees', '₹12,50,000.49', '−₹2,40,000.00'])
    expect(drawn.querySelector('td.fd-negative')!.textContent).toBe('−₹2,40,000.00')
    expect(find('ask-data-line')!.textContent).toContain('14-Nov-2026')
    expect(find('ask-covers')!.textContent).toBe('Covers: 9901')
    expect([...find('ask-definitions')!.querySelectorAll('li')].map(line => line.textContent)).toEqual(['Target: sum of target', 'Gap: sales - target'])
    expect(find('ask-sql')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
  })

  it('a name that matched nothing is said, with no empty table; rows that were cut are counted', async () => {
    await draw({ question: 'How is Silk Sarees doing?', result: { ...result, rows: [], unmatched: [{ dimension: 'subcategory', value: 'Silk Sarees' }] } })
    expect(find('ask-unmatched')!.textContent).toBe('“Silk Sarees” is not one of your subcategories, so nothing matched it.')
    expect(find('ask-nothing')!.textContent).toBe('Nothing matched that question.')
    expect(find('report-answer')!.querySelector('table')).toBeNull()
    unmount()
    await draw({ question: 'All of them?', result: { ...result, truncated: true, columns: [{ name: 'subcategory', kind: 'dimension' }], rows: [['Silk sarees']] } })
    expect(find('report-answer')!.textContent).toContain('Showing the first 1 rows.')
    expect(find('ask-definitions')).toBeNull()
  })

  it('shows the SQL when SQL worked it out, and closes when asked', async () => {
    let closed = 0
    const { act } = await draw({ question: 'Sales by store?', sql: 'select store from sales_vs_target', result }, () => { closed++ })
    expect(find('ask-sql')!.textContent).toBe('select store from sales_vs_target')
    await act(async () => { (find('report-close') as HTMLElement).click() })
    expect(closed).toBe(1)
  })
})
