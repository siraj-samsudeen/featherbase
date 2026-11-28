// The managers' totals strip, in Siraj's order (28-Nov): Feather Forecast, Last year, Last month and AOP, each with its value, quantity and
// ASP, then the Gap to AOP tinted by its band, then whatever tile the page adds (the Store Manager's review
// progress, the category head's "behind AOP" counts). Approved changes show as "With approved changes ₹X" and move
// the gap. The tiles are Shop Floor cards (quiet fill); the tints are its tone tokens.
import type { ReactNode } from 'react'
import { cardClasses, cx } from '@featherbase/shop-floor'
import { aopTone } from './Aop'
import { count, inr, pc, type Group, type Line } from './model'
import type { Header } from './review'

type Total = Pick<Line | Group, 'fc' | 'fq' | 'r31' | 'r31q' | 'ly' | 'lyq' | 'aop' | 'aq'>
const TINT = { positive: 'bg-positive-tint', caution: 'bg-caution-tint', negative: 'bg-negative-tint', missing: '', neutral: '' } as const
const INK = { positive: 'text-positive', caution: 'text-caution', negative: 'text-negative', missing: 'text-ink', neutral: 'text-ink' } as const
const asp = (v: number, q: number) => (q > 0 ? `₹${count(v / q)}` : '—')

/** One tile: a name, the figure, and small lines under it. */
export function Tile({ name, value, lines, className, valueClass, testId }: { name: string; value: ReactNode; lines?: ReactNode[]; className?: string; valueClass?: string; testId?: string }) {
  return (
    <div className={cardClasses(cx('fr-kpi', className))} data-testid={testId}>
      <span className="fr-kpi-name">{name}</span>
      <b className={cx('fr-kpi-value', valueClass)}>{value}</b>
      {lines?.filter(Boolean).map((l, i) => <span key={i} className="fr-kpi-line">{l}</span>)}
    </div>
  )
}

export function KpiTiles({ total, header, approvedDelta = 0, extra, valueOnly = false }: {
  total: Total; header: Header
  /** What approved changes add to Feather Forecast (may be negative). */
  approvedDelta?: number
  /** The page's own tile(s), after Gap to AOP. */
  extra?: ReactNode
  /** Value only: the total spans more than one category, whose pieces do not add up (RB, 28-Nov). */
  valueOnly?: boolean
}) {
  const t = total, after = t.fc + approvedDelta
  const tone = aopTone({ fc: after, aop: t.aop })
  return (
    <div className="fr-kpis" data-testid="kpi-tiles">
      <Tile name="Feather Forecast" value={inr(t.fc)} className="fr-kpi-lead" lines={[valueOnly ? null : `${count(t.fq)} qty · ASP ${asp(t.fc, t.fq)}`,
        approvedDelta ? <b>With approved changes {inr(after)}</b> : null]} />
      <Tile name="Last year" value={inr(t.ly)} lines={[valueOnly ? null : `${count(t.lyq)} qty · ASP ${asp(t.ly, t.lyq)}`, `Forecast ${pc(t.fc, t.ly)}`]} />
      <Tile name="Last month (31-day rate)" value={inr(t.r31)} lines={[valueOnly ? null : `${count(t.r31q)} qty · ASP ${asp(t.r31, t.r31q)}`, `Forecast ${pc(t.fc, t.r31)}`]} />
      <Tile name="AOP" value={inr(t.aop)} lines={[valueOnly ? null : `${count(t.aq)} qty · ASP ${asp(t.aop, t.aq)}`, `Forecast is ${t.aop ? Math.round(after / t.aop * 100) : '—'}% of AOP`]} />
      <Tile name="Gap to AOP" value={t.aop ? inr(after - t.aop) : '—'} className={TINT[tone]} valueClass={INK[tone]} testId="kpi-gap"
        lines={[after >= t.aop ? 'On or above the plan' : `To catch up in ${header.month.name}`]} />
      {extra}
    </div>
  )
}
