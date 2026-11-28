// The review table (TL-13..TL-19, TL-25): column blocks (Feather Forecast · Last year · Last month · AOP; Siraj's order, 28-Nov), each
// with the measures Show picked, then Value vs and Built from. Rows come in already in order, one per visible
// row (a subcategory, a group, a level of a tree; levels.ts turns a hierarchy into them); clicking a row opens
// the page's own panel under it, as wide as the visible table. The look is Shop Floor's TableLook, written out
// in forecasting.css because the column bands and the pinned first column are not in TableLook yet.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, PartsBar, cx } from '@featherbase/shop-floor'
import { Hover } from './Hover'
import { asp, contribution, count, inr, pc, shares, type Group, type Line } from './model'
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
}
type Block = [string, string, string, string]

/** Each row's parent, by key ('' for the top): the nearest row above it one level up, a row's level being its tree
 *  depth, or 1 for a group's member. Rows with one parent are siblings, whose shares come to 100%. */
export function parentsOf(rows: Pick<TableRow, 'key' | 'depth' | 'look'>[]): Map<string, string> {
  const parent = new Map<string, string>(), stack: string[] = []
  for (const r of rows) {
    const lv = r.depth ?? ((r.look ?? []).includes('member') ? 1 : 0)
    stack.length = lv
    parent.set(r.key, lv ? stack[lv - 1] ?? '' : '')
    stack[lv] = r.key
  }
  return parent
}

export function MeasureTable({ header, view, rows, total, totalLabel = 'Section', firstHeading = 'Subcategory', open, onToggle, panel, flash }: {
  header: Header; view: ViewChoices; rows: TableRow[]; total: Item; totalLabel?: string; firstHeading?: string
  open: string | null; onToggle: (key: string | null) => void
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
    ...(view.aop ? [['aop', 'aq', 'AOP', `The annual plan for ${month.label}`] as Block] : []),
  ]
  const measures = ({ all: ['v', 'q', 'a'], vq: ['v', 'q'], v: ['v'], q: ['q'] } as const)[view.measure]
  // Value vs stays against last year and last month, AOP on or off (prototype b93dacc16)
  const vs = 2
  // Feather Forecast and Last year each end in a Share column: the row's value among its siblings (the section's
  // top rows, or a group's members), so siblings come to 100% and the total row shows 100%
  const SHARED = new Set(['fc', 'ly'])
  const span = (b: Block) => measures.length + (SHARED.has(b[0]) ? 1 : 0)
  const columns = 1 + blocks.reduce((t, b) => t + span(b), 0) + vs + 1
  const parentOf = parentsOf(rows)
  const siblingsTotal = (key: string, k: string) => rows.filter(x => parentOf.get(x.key) === parentOf.get(key))
    .reduce((t, x) => t + ((x.item as unknown as Record<string, number>)[k] || 0), 0)
  const cell = (l: Item, [k, q]: Block, m: 'v' | 'q' | 'a', first: boolean, cls: string) => {
    const v = (l as unknown as Record<string, number>)[k], qty = (l as unknown as Record<string, number>)[q]
    return <td key={`${k}${m}`} className={`${first ? 'fr-b0 ' : ''}${cls}`}>{m === 'v' ? inr(v) : m === 'q' ? count(qty) : asp(v, qty)}</td>
  }
  const share = (key: string | null, l: Item, k: string) => {
    const v = (l as unknown as Record<string, number>)[k] || 0
    return key == null ? (v ? '100%' : '—') : contribution(v, siblingsTotal(key, k))
  }
  const figures = (l: Item, strong: boolean, key: string | null) => <>
    {blocks.map((b, bi) => <Fragment key={b[0]}>
      {measures.map((m, mi) => cell(l, b, m, mi === 0, strong && bi === 0 ? 'fr-fc' : strong ? 'fr-dim' : ''))}
      {SHARED.has(b[0]) && <td className="fr-dim fr-share">{share(key, l, b[0])}</td>}
    </Fragment>)}
    <td className="fr-b0">{pc(l.fc, l.ly)}</td><td>{pc(l.fc, l.r31)}</td>
    <td className="fr-b0"><PartsBar parts={shares(l)} shape={view.shape} /></td>
  </>

  return (
    <div className="fr-scroll" ref={scroller}>
      <table className="fr-table">
        <thead>
          <tr className="fr-blocks"><th />
            {blocks.map(b => <th key={b[2]} colSpan={span(b)} className="fr-b0"><Hover text={b[3]}>{b[2]}</Hover></th>)}
            <th colSpan={vs} className="fr-b0"><Hover text="Feather Forecast's value against last year and last month">Value vs</Hover></th>
            <th className="fr-b0">Built from</th></tr>
          <tr><th>{firstHeading}</th>
            {blocks.map(b => <Fragment key={b[2]}>
              {measures.map((m, i) => <th key={b[2] + m} className={i === 0 ? 'fr-b0' : ''}>{{ v: 'Value', q: 'Qty', a: 'ASP' }[m]}</th>)}
              {SHARED.has(b[0]) && <th><Hover text={`This row's ${b[2]} value as a share of the rows beside it (a group's members, or the section's rows)`}>Share</Hover></th>}
            </Fragment>)}
            <th className="fr-b0"><Hover text={`${month.name} ${month.year - 1}`}>Last year</Hover></th>
            <th><Hover text={`Last 28 days at ${month.name}'s ${month.days} days`}>Last month</Hover></th>
            <th className="fr-b0" /></tr>
        </thead>
        <tbody>{rows.map(r => {
          const isOpen = open === r.key, look = r.look ?? []
          return (
            <Fragment key={r.key}>
              <tr className={['fr-row', look.includes('band') && 'fr-band', look.includes('head') && 'fr-ghead', look.includes('member') && 'fr-member'].filter(Boolean).join(' ')}
                data-key={r.key} data-n={r.dataName ?? r.key} aria-selected={isOpen} aria-expanded={r.opens === false ? undefined : isOpen}
                onClick={e => { if (r.opens === false) return; if ((e.target as HTMLElement).closest('a') && (e.metaKey || e.ctrlKey || e.shiftKey)) return; onToggle(isOpen ? null : r.key) }}>
                <td style={r.depth ? { paddingLeft: 10 + 26 * r.depth } : undefined}>
                  <span className="fr-name"><span className="fr-twisty" aria-hidden>{r.opens !== false && <ChevronRight size={14} className={cx('transition-transform motion-reduce:transition-none', isOpen && 'rotate-90')} />}</span>{r.label}{r.after}</span>
                  {r.note && <span className="fr-gwhy">{r.note}</span>}
                </td>
                {figures(r.item, true, r.key)}
              </tr>
              {isOpen && <tr className="fr-panelrow"><td colSpan={columns}>{panel(r, width)}</td></tr>}
            </Fragment>)
        })}</tbody>
        <tfoot><tr><td>{totalLabel}</td>{figures(total, false, null)}</tr></tfoot>
      </table>
    </div>
  )
}
