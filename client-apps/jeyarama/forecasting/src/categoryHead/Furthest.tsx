// Furthest From Plan (the category head's prototype, option C): two compact ranked tables side by side, the 15
// biggest shortfalls to AOP and the 15 biggest changes on last year, by store × subcategory or store × category.
// A subcategory opens its panel under its row; a category at a store opens Drill Table there. Shop Floor's
// TableLook in Compact Rows.
import { Fragment, type ReactNode } from 'react'
import { RecordLink, cellClasses, cx, headCellClasses, TABLE_CLASSES } from '@featherbase/shop-floor'
import { inr, pc, type Line } from '../shared/model'
import { LINE_TABLE } from '../shared/ReviewTree'
import { ToolbarChoice } from '../shared/ReviewToolbar'
import { rankings, type RankBy, type Ranked } from './heads'

export type Side = 'aop' | 'ly'
const N = 15

export function Furthest({ lines, rank, onRank, open, onOpen, onCategory, hrefFor, pills, panel }: {
  lines: Line[]; rank: RankBy; onRank: (r: RankBy) => void
  /** The opened subcategory and the list it was opened from. */
  open: { key: string; side: Side } | null; onOpen: (o: { key: string; side: Side } | null) => void
  /** A category at a store was clicked. */
  onCategory: (store: string, category: string) => void
  hrefFor: (l: Line) => string
  pills: (l: Line) => ReactNode
  panel: (l: Line) => ReactNode
}) {
  const r = rankings(lines, rank, N)
  const click = (o: Ranked, side: Side) => {
    if (!o.line) return onCategory(o.store, o.category)
    onOpen(open?.key === o.key && open.side === side ? null : { key: o.key, side })
  }
  const table = (side: Side, title: string, note: string, list: Ranked[]) => {
    const refName = side === 'aop' ? 'AOP' : 'Last year'
    return (
      <div className="ch-rank" data-testid={`rank-${side}`}>
        <h2 className="fr-sec">{title} <span className="fr-dim">{note}</span></h2>
        <table className={cx(TABLE_CLASSES, 'ch-rk')}>
          <colgroup><col /><col className="ch-num" /><col className="ch-num" /><col className="ch-num" /><col className="ch-pct" /></colgroup>
          <thead><tr>
            <th className={headCellClasses({ first: true, className: 'px-1.5!' })}>{rank === 'line' ? 'Store · Subcategory' : 'Store · Category'}</th>
            <th className={headCellClasses({ className: 'px-1.5! text-right' })}>Feather Forecast</th>
            <th className={headCellClasses({ className: 'px-1.5! text-right' })}>{refName}</th>
            <th className={headCellClasses({ className: 'px-1.5! text-right' })}>Gap</th>
            <th className={headCellClasses({ last: true, className: 'px-1.5! text-right' })}>%</th></tr></thead>
          <tbody>{list.map(o => {
            const ref = side === 'aop' ? o.item.aop : o.item.ly, gap = o.item.fc - ref
            const isOpen = !!o.line && open?.key === o.key && open.side === side
            const td = (first = false, last = false, extra = '') => cellClasses({ density: 'compact', first, last, className: cx('px-1.5!', extra) })
            return (
              <Fragment key={o.key}>
                <tr className="group cursor-pointer" aria-selected={isOpen} data-key={o.key} onClick={e => { if ((e.target as HTMLElement).closest('a') && (e.metaKey || e.ctrlKey || e.shiftKey)) return; click(o, side) }}>
                  <td className={td(true, false, 'ch-name')}>
                    <b>{o.store}</b>{' · '}
                    {o.line ? <RecordLink table={LINE_TABLE} rowId={o.line.rowId} name={o.name} href={hrefFor(o.line)} onNavigate={() => {}} /> : o.name}
                    {o.line && pills(o.line)}
                  </td>
                  <td className={td(false, false, 'text-right font-semibold tabular-nums')}>{inr(o.item.fc)}</td>
                  <td className={td(false, false, 'text-right tabular-nums')}>{inr(ref)}</td>
                  <td className={td(false, false, cx('text-right tabular-nums', gap >= 0 ? 'text-positive' : 'text-negative'))}>{gap >= 0 ? '+' : ''}{inr(gap)}</td>
                  <td className={td(false, true, 'text-right tabular-nums')}>{pc(o.item.fc, ref)}</td>
                </tr>
                {isOpen && o.line && <tr className="ch-panelrow"><td colSpan={5}>{panel(o.line)}</td></tr>}
              </Fragment>)
          })}</tbody>
        </table>
      </div>)
  }
  return <>
    <div className="fr-toolbar fr-toolbar-wrap">
      <ToolbarChoice label="Rank" hover="Rank single subcategories, or whole categories at a store" value={rank} onChange={onRank}
        options={[{ value: 'line', label: 'Store × subcategory' }, { value: 'cat', label: 'Store × category' }]} />
    </div>
    <div className="ch-ranks">
      {table('aop', 'Furthest Behind AOP', `the ${N} biggest shortfalls in rupees`, r.behindAop)}
      {table('ly', 'Furthest From Last Year', `the ${N} biggest changes in rupees, up or down`, r.fromLastYear)}
    </div>
  </>
}
