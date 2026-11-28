// The review table (TL-13..TL-19, TL-25): column blocks (Feather Forecast · Last year · Last month · AOP; Siraj's order, 28-Nov), each
// with the measures Show picked, then Value vs and Built from. Rows come in already in order, one per visible
// row (a subcategory, a group, a level of a tree; levels.ts turns a hierarchy into them); clicking a row opens
// the page's own panel under it, as wide as the visible table. The look is Shop Floor's TableLook, written out
// in forecasting.css because the column bands and the pinned first column are not in TableLook yet.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, PartsBar, cx } from '@featherbase/shop-floor'
import { Hover } from './Hover'
import { asp, count, inr, pc, shares, type Group, type Line } from './model'
import { VsAop } from './Aop'
import { shareOf } from './levels'
import type { Header } from './review'
import type { ViewChoices } from './ReviewToolbar'

export type Item = Line | Group
export interface TableRow {
  /** Unique among the rows; the open row's key. `data-n` carries `dataName` (or the key) for tests and jumps. */
  key: string; dataName?: string; item: Item
  /** What the first cell shows (a RecordLink, a group tag, a level name), and anything after it (status pills). */
  label: ReactNode; after?: ReactNode
  /** A line under the label (a group's "Moved in opposite directions"). */
  note?: ReactNode
  /** Look: 'band' (a group's violet band), 'head' (a taller first row of a band), 'member' (indented under a group). */
  look?: ('band' | 'head' | 'member')[]
  /** How far down a tree the row is (0 at the top); each step indents the name. */
  depth?: number
  /** Whether clicking it opens a panel. */
  opens?: boolean
  /** A muted line under the name (a floor's "10 sections · 36 subcategories", a section's Team Leader). */
  sub?: ReactNode
  /** A tree node: clicking runs this instead of opening a panel, and `expanded` turns its chevron. */
  onClick?: () => void
  expanded?: boolean
  /** The row's parent (the node it sits under, or the table's total at the top): its Share is this row's part of the
   *  parent's figure, so siblings add up to 100%. */
  parent?: Item
}
/** What the managers' tables sort by, from three headings: Feather Forecast (biggest first), Last year under
 *  Value vs (biggest change in rupees first), AOP under Value vs (furthest behind the plan first). */
export type SortKey = 'size' | 'ly' | 'aop'
export const SORTERS: Record<SortKey, (a: { fc: number; ly: number; aop: number }, b: { fc: number; ly: number; aop: number }) => number> = {
  size: (a, b) => b.fc - a.fc,
  ly: (a, b) => Math.abs(b.fc - b.ly) - Math.abs(a.fc - a.ly),
  aop: (a, b) => (a.fc - a.aop) - (b.fc - b.aop),
}
type Block = [string, string, string, string]

export function MeasureTable({ header, view, rows, total, totalLabel = 'Section', firstHeading = 'Subcategory', open, onToggle, panel, flash, vsAop = false, sort, onSort, valueOnly, rowEnd, share = false }: {
  header: Header; view: ViewChoices; rows: TableRow[]; total: Item; totalLabel?: string; firstHeading?: string
  /** The managers' columns: AOP always shown, and Feather Forecast against it under Value vs (no Gap to AOP column:
   *  the KPI tile carries the gap, owner 27-Nov-2026). */
  vsAop?: boolean
  /** The heading the rows are sorted by (marked ↓); with onSort the three headings sort when clicked. */
  sort?: SortKey; onSort?: (k: SortKey) => void
  open: string | null; onToggle: (key: string | null) => void
  /** A row whose quantity means nothing (pieces of different categories, RB 28-Nov) shows its value only. */
  valueOnly?: (item: Item) => boolean
  /** A last cell on each row (RB's ⓘ, opening the row's card in the side pane). */
  rowEnd?: (row: TableRow) => ReactNode
  /** A Share column after Value under Feather Forecast and under Last year: each row's part of its siblings' total. */
  share?: boolean
  /** The panel an open row shows, given its width (the visible table's). */
  panel: (row: TableRow, width: number | undefined) => ReactNode
  /** A row to scroll to the top and flash; a new `n` flashes it again. */
  flash?: { key: string; n: number } | null
}) {
  const { month } = header
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    const measure = () => setWidth(scroller.current?.clientWidth)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  useEffect(() => {
    if (!flash) return
    const row = scroller.current?.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(flash.key)}"]`)
    if (!row) return
    row.scrollIntoView({ block: 'start', behavior: 'instant' })
    window.scrollBy(0, -12)
    row.classList.remove('fr-flash'); void row.offsetWidth; row.classList.add('fr-flash')
  }, [flash])

  const blocks: Block[] = [
    ['fc', 'fq', 'Feather Forecast', `Feather Forecast for ${month.name}`],
    ['ly', 'lyq', 'Last year', `${month.name} ${month.year - 1}`],
    ['r31', 'r31q', 'Last month', `Last 28 days to ${header.cutOff}, as a rate per day × ${month.name}'s ${month.days} days`],
    ...(view.aop || vsAop ? [['aop', 'aq', 'AOP', `The annual plan for ${month.label}`] as Block] : []),
  ]
  const sortable = (k: SortKey, text: ReactNode, tip: string) => onSort
    ? <button type="button" className="fr-sort" aria-pressed={sort === k} title={`${tip}. ${sort === k ? 'Rows are sorted by this' : 'Click to sort by this'}`}
      onClick={() => onSort(k)}>{text}{sort === k && <span aria-hidden> ↓</span>}</button>
    : text
  const measures = ({ all: ['v', 'q', 'a'], vq: ['v', 'q'], v: ['v'], q: ['q'] } as const)[view.measure]
  const showAop = view.aop || vsAop
  const vs = showAop ? 3 : 2
  type M = 'v' | 's' | 'q' | 'a'
  /** A block's sub-columns: the measures picked, with Share after Value under Feather Forecast and Last year. */
  const colsOf = (b: Block): M[] => (share && (b[0] === 'fc' || b[0] === 'ly') ? measures.flatMap((m): M[] => (m === 'v' ? ['v', 's'] : [m])) : [...measures])
  const columns = 1 + blocks.reduce((t, b) => t + colsOf(b).length, 0) + vs + 1 + (rowEnd ? 1 : 0)
  const cell = (l: Item, [k, q]: Block, m: M, first: boolean, cls: string, parent: Item) => {
    const at = (o: Item, key: string) => (o as unknown as Record<string, number>)[key]
    const v = at(l, k), qty = at(l, q)
    const blank = (m === 'q' || m === 'a') && valueOnly?.(l)
    return <td key={`${k}${m}`} className={`${first ? 'fr-b0 ' : ''}${m === 's' ? 'fr-share ' : ''}${cls}`}>{blank ? '' : m === 'v' ? inr(v) : m === 's' ? shareOf(v, at(parent, k)) : m === 'q' ? count(qty) : asp(v, qty)}</td>
  }
  const figures = (l: Item, strong: boolean, parent: Item = total) => <>
    {blocks.map((b, bi) => colsOf(b).map((m, mi) => cell(l, b, m, mi === 0, m === 's' ? 'fr-dim' : strong && bi === 0 ? 'fr-fc' : strong ? 'fr-dim' : '', parent)))}
    <td className="fr-b0">{pc(l.fc, l.ly)}</td><td>{pc(l.fc, l.r31)}</td>
    {showAop && <td>{vsAop ? <VsAop o={l} /> : pc(l.fc, l.aop)}</td>}
    <td className="fr-b0"><PartsBar parts={shares(l)} shape={view.shape} /></td>
  </>

  return (
    <div className="fr-scroll" ref={scroller}>
      <table className={vsAop ? "fr-table fr-table-mgr" : "fr-table"}>
        <thead>
          <tr className="fr-blocks"><th />
            {blocks.map((b, i) => <th key={b[2]} colSpan={colsOf(b).length} className="fr-b0">{i === 0 && onSort ? sortable('size', b[2], `${b[3]}, biggest first`) : <Hover text={b[3]}>{b[2]}</Hover>}</th>)}
            <th colSpan={vs} className="fr-b0"><Hover text={`Feather Forecast's value against last year, last month${showAop ? ' and the AOP' : ''}`}>Value vs</Hover></th>
            <th className="fr-b0">Built from</th>{rowEnd && <th />}</tr>
          <tr><th><span className="fr-first" title={firstHeading}>{firstHeading}</span></th>
            {blocks.map(b => colsOf(b).map((m, i) => <th key={b[2] + m} className={i === 0 ? 'fr-b0' : ''}>{m === 's'
              ? <Hover text={`Each row's part of the rows beside it at the same level (they add up to 100%): ${b[0] === 'fc' ? 'Feather Forecast' : `${month.name} ${month.year - 1}`}`}>Share</Hover>
              : { v: 'Value', q: 'Qty', a: 'ASP' }[m]}</th>))}
            <th className="fr-b0">{onSort ? sortable('ly', vsAop ? <>Last<br />year</> : 'Last year', `${month.name} ${month.year - 1}, biggest change in rupees first`) : <Hover text={`${month.name} ${month.year - 1}`}>Last year</Hover>}</th>
            <th><Hover text={`Last 28 days at ${month.name}'s ${month.days} days`}>{vsAop ? <>Last<br />month</> : 'Last month'}</Hover></th>
            {showAop && <th>{onSort ? sortable('aop', 'AOP', 'Feather Forecast against the annual plan, furthest behind first') : <Hover text={`The annual plan for ${month.label}`}>AOP</Hover>}</th>}<th className="fr-b0" />{rowEnd && <th />}</tr>
        </thead>
        <tbody>{rows.map(r => {
          const isOpen = r.onClick ? Boolean(r.expanded) : open === r.key, look = r.look ?? []
          return (
            <Fragment key={r.key}>
              <tr className={['fr-row', look.includes('band') && 'fr-band', look.includes('head') && 'fr-ghead', look.includes('member') && 'fr-member', r.sub && 'fr-tall'].filter(Boolean).join(' ')}
                data-key={r.key} data-n={r.dataName ?? r.key} aria-selected={isOpen && !r.onClick} aria-expanded={r.opens === false ? undefined : isOpen}
                onClick={e => { if (r.opens === false) return; if ((e.target as HTMLElement).closest('a') && (e.metaKey || e.ctrlKey || e.shiftKey)) return; if (r.onClick) r.onClick(); else onToggle(isOpen ? null : r.key) }}>
                <td style={r.depth ? { paddingLeft: 10 + (vsAop ? 16 : 26) * r.depth } : undefined}>
                  <span className="fr-name"><span className="fr-twisty" aria-hidden>{r.opens !== false && <ChevronRight size={14} className={cx('transition-transform motion-reduce:transition-none', isOpen && 'rotate-90')} />}</span>{r.label}{r.after}</span>
                  {r.note && <span className="fr-gwhy">{r.note}</span>}
                  {r.sub && <span className="fr-sub" style={r.depth ? { marginLeft: 22 } : undefined}>{r.sub}</span>}
                </td>
                {figures(r.item, true, r.parent)}
                {rowEnd && <td className="fr-rowend">{rowEnd(r)}</td>}
              </tr>
              {isOpen && !r.onClick && <tr className="fr-panelrow"><td colSpan={columns}>{panel(r, width)}</td></tr>}
            </Fragment>)
        })}</tbody>
        <tfoot><tr><td>{totalLabel}</td>{figures(total, false)}{rowEnd && <td />}</tr></tfoot>
      </table>
    </div>
  )
}
