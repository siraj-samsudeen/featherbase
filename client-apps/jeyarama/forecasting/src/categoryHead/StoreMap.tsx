// Store Map (the category head's prototype, option B): categories down, the region's stores across (biggest
// first) and "All", each cell Feather Forecast against AOP, last year or last month (or its value), tinted by how
// far it sits: Shop Floor's negative tone below, positive above. A category row opens its subcategories; a cell
// opens what is in it below the map, as the review table. Shop Floor has no heat map, so the map is drawn here on
// its tokens (categoryHead.css).
import type { CSSProperties, ReactNode } from 'react'
import { ChevronRight, cx } from '@featherbase/shop-floor'
import { inr, pc, type Line } from '../shared/model'
import { SORTERS, type SortKey } from '../shared/MeasureTable'
import { ToolbarChoice } from '../shared/ReviewToolbar'
import { matrix, METRICS, type Cell, type Metric, type MatrixRow } from './heads'

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [{ value: 'aop', label: 'Gap to AOP' }, { value: 'ly', label: 'Gap to last year' }, { value: 'size', label: 'Size' }]
const TONE = { below: ['--color-negative', 46], above: ['--color-positive', 46], size: ['--color-action', 40] } as const

const cellStyle = (c: Cell): CSSProperties | undefined => {
  if (!c.tint) return undefined
  const [token, most] = TONE[c.tint.tone]
  return { background: `color-mix(in srgb, var(${token}) ${Math.round(c.tint.strength * most)}%, transparent)` }
}
const cellText = (metric: Metric, c: Cell) => metric === 'v' ? inr(c.item?.fc ?? 0).replace('₹', '') : c.value == null || !c.item ? '—'
  : pc(c.item.fc, metric === 'aop' ? c.item.aop : metric === 'ly' ? c.item.ly : c.item.r31)

export interface CellPick { row: string; store: string | null }

export function StoreMap({ lines, stores, metric, onMetric, sort, onSort, openCats, onToggleCat, cell, onCell, below }: {
  lines: Line[]; stores: { code: string; name: string }[]
  metric: Metric; onMetric: (m: Metric) => void; sort: SortKey; onSort: (k: SortKey) => void
  openCats: Set<string>; onToggleCat: (cat: string) => void
  cell: CellPick | null; onCell: (c: CellPick | null) => void
  /** What a picked cell opens below the map (the review table of its subcategories). */
  below: ReactNode
}) {
  const codes = stores.map(s => s.code)
  const rows = matrix(lines, codes, metric, openCats, SORTERS[sort])
  const total = matrix(lines.map(l => ({ ...l, category: '*' })), codes, metric, new Set(), SORTERS[sort])[0]?.row
  const td = (r: MatrixRow, c: Cell, all = false) => {
    if (!c.item) return <td key={c.store ?? 'all'} className="ch-none">·</td>
    const picked = cell?.row === r.key && cell.store === c.store
    const where = c.store ? `${c.store} ${stores.find(s => s.code === c.store)?.name ?? ''}` : 'all stores'
    return (
      <td key={c.store ?? 'all'} className={cx(all && 'ch-all')} style={cellStyle(c)} aria-selected={picked} tabIndex={0} role="button"
        title={`${r.key === '*' ? 'All categories' : r.label} at ${where}: Feather Forecast ${inr(c.item.fc)} · last month ${inr(c.item.r31)} · last year ${inr(c.item.ly)} · AOP ${inr(c.item.aop)}`}
        onClick={() => onCell(picked ? null : { row: r.key, store: c.store })}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCell(picked ? null : { row: r.key, store: c.store }) } }}>
        {cellText(metric, c)}
      </td>)
  }
  const line = (r: MatrixRow, head: ReactNode) => <tr key={r.key}>{head}{r.cells.map(c => td(r, c))}{td(r, r.all, true)}</tr>
  return <>
    <div className="fr-toolbar fr-toolbar-wrap">
      <ToolbarChoice label="Show" hover="Feather Forecast against the plan, last year or last month, or its value" value={metric} onChange={onMetric} options={METRICS} />
      <ToolbarChoice label="Sort" hover="The order of the categories: furthest behind AOP, biggest change on last year, or biggest first" value={sort} onChange={onSort} options={SORT_OPTIONS} />
    </div>
    <div className="fr-legend ch-scale">
      {metric === 'v' ? <span>Darker = bigger within the row.</span> : <span className="ch-scale-steps">
        <i style={{ background: 'color-mix(in srgb, var(--color-negative) 46%, transparent)' }} />40% or more below
        <i style={{ background: 'color-mix(in srgb, var(--color-negative) 18%, transparent)' }} />
        <i style={{ background: 'var(--color-subtle)' }} />level
        <i style={{ background: 'color-mix(in srgb, var(--color-positive) 18%, transparent)' }} />
        <i style={{ background: 'color-mix(in srgb, var(--color-positive) 46%, transparent)' }} />40% or more above</span>}
      <span>Stores run left to right, biggest first. Click a category to see its subcategories; click a cell to open it below.</span>
    </div>
    <div className="fr-scroll">
      <table className="ch-map" data-testid="store-map">
        <thead><tr><th className="ch-rn">Category › Subcategory</th>{stores.map(s => <th key={s.code} title={s.name}>{s.code}</th>)}<th className="ch-all">All</th></tr></thead>
        <tbody>{rows.map(({ row, subs }) => {
          const open = openCats.has(row.key)
          return [
            line(row, <th className="ch-rn" role="button" aria-expanded={open} onClick={() => onToggleCat(row.key)}>
              <span className="fr-twisty" aria-hidden><ChevronRight size={14} className={cx('transition-transform motion-reduce:transition-none', open && 'rotate-90')} /></span><b>{row.label}</b></th>),
            ...subs.map(s => line(s, <th className="ch-rn ch-rn-sub">{s.label}</th>)),
          ]
        })}</tbody>
        {total && <tfoot>{line({ ...total, key: '*', label: 'All categories' }, <th className="ch-rn"><b>All categories</b></th>)}</tfoot>}
      </table>
    </div>
    {below}
  </>
}
