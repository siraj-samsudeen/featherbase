// The review table (TL-13..TL-19, TL-25): column blocks (Feather Forecast · Last year · Last month · AOP; Siraj's order, 28-Nov), each
// with the measures Show picked, then Value vs and Built from. Rows come in already in order, one per visible
// row (a subcategory, a group, a level of a tree; levels.ts turns a hierarchy into them); clicking a row opens
// the page's own panel under it, as wide as the visible table. The look is Shop Floor's TableLook, written out
// in forecasting.css because the column bands and the pinned first column are not in TableLook yet.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, PartsBar, cx } from '@featherbase/shop-floor'
import { Hover } from './Hover'
import { asp, count, inr, pc, shares, type Group, type Line } from './model'
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
  const vs = view.aop ? 3 : 2
  const columns = 1 + blocks.length * measures.length + vs + 1
  const cell = (l: Item, [k, q]: Block, m: 'v' | 'q' | 'a', first: boolean, cls: string) => {
    const v = (l as unknown as Record<string, number>)[k], qty = (l as unknown as Record<string, number>)[q]
    return <td key={`${k}${m}`} className={`${first ? 'fr-b0 ' : ''}${cls}`}>{m === 'v' ? inr(v) : m === 'q' ? count(qty) : asp(v, qty)}</td>
  }
  const figures = (l: Item, strong: boolean) => <>
    {blocks.map((b, bi) => measures.map((m, mi) => cell(l, b, m, mi === 0, strong && bi === 0 ? 'fr-fc' : strong ? 'fr-dim' : '')))}
    <td className="fr-b0">{pc(l.fc, l.ly)}</td><td>{pc(l.fc, l.r31)}</td>{view.aop && <td>{pc(l.fc, l.aop)}</td>}
    <td className="fr-b0"><PartsBar parts={shares(l)} shape={view.shape} /></td>
  </>

  return (
    <div className="fr-scroll" ref={scroller}>
      <table className="fr-table">
        <thead>
          <tr className="fr-blocks"><th />
            {blocks.map(b => <th key={b[2]} colSpan={measures.length} className="fr-b0"><Hover text={b[3]}>{b[2]}</Hover></th>)}
            <th colSpan={vs} className="fr-b0"><Hover text={`Feather Forecast's value against last year, last month${view.aop ? ' and the AOP' : ''}`}>Value vs</Hover></th>
            <th className="fr-b0">Built from</th></tr>
          <tr><th>{firstHeading}</th>
            {blocks.map(b => measures.map((m, i) => <th key={b[2] + m} className={i === 0 ? 'fr-b0' : ''}>{{ v: 'Value', q: 'Qty', a: 'ASP' }[m]}</th>))}
            <th className="fr-b0"><Hover text={`${month.name} ${month.year - 1}`}>Last year</Hover></th>
            <th><Hover text={`Last 28 days at ${month.name}'s ${month.days} days`}>Last month</Hover></th>
            {view.aop && <th><Hover text={`The annual plan for ${month.label}`}>AOP</Hover></th>}<th className="fr-b0" /></tr>
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
                {figures(r.item, true)}
              </tr>
              {isOpen && <tr className="fr-panelrow"><td colSpan={columns}>{panel(r, width)}</td></tr>}
            </Fragment>)
        })}</tbody>
        <tfoot><tr><td>{totalLabel}</td>{figures(total, false)}</tr></tfoot>
      </table>
    </div>
  )
}
