// How it was built (the 26-Nov mockup's third tab): what each kind of evidence adds to a forecast, for whatever is
// in view. Shared by the Workspace and the Team Leader's Day Review; the caller says what is in view and gives what
// each base adds.
import type { ReactNode } from 'react'
import { Button, Card, fmtINR } from '@featherbase/shop-floor'
import type { BasisCode } from './model'

/** What each base adds to the forecast, in ₹. */
export type Adds = Partial<Record<BasisCode, number>>

export function HowBuilt({ fc, adds, title, facts, picker, note, onDays }: {
  fc: number; adds: Adds
  /** The heading: "How the engine reached ₹X for <scope>". */
  title: ReactNode
  /** The line under the heading (the AOP and how far off it, the number of lines). */
  facts: ReactNode
  /** A choice of what is in view, beside the heading. */
  picker?: ReactNode
  note?: ReactNode
  onDays: () => void
}) {
  const add = (codes: BasisCode[]) => codes.reduce((t, c) => t + (adds[c] ?? 0), 0)
  const groups = [
    { name: "Last year's December", what: "Same date and same Christmas position last year, × this year's growth. Weekday-corrected: a Wednesday is compared with a Wednesday.", codes: ['B1', 'B2'] as BasisCode[], tone: 'bg-action' },
    { name: 'The seasonal step', what: 'The last 28 days × the usual November-to-December jump from past years.', codes: ['B6'] as BasisCode[], tone: 'bg-opportunity' },
    { name: 'The last few weeks', what: 'The last 28 days, the last four same weekdays, and the same date last month.', codes: ['B3', 'B4', 'B5'] as BasisCode[], tone: 'bg-positive' },
  ].map(g => ({ ...g, value: add(g.codes) }))
  const other = fc - groups.reduce((t, g) => t + g.value, 0)
  return (
    <Card><div className="flex max-w-3xl flex-col gap-3 p-4" data-testid="how-built">
      <div className="flex flex-wrap items-start justify-between gap-2"><div className="text-lg font-bold">{title}</div>{picker}</div>
      <div className="text-sm text-ink-muted">{facts}</div>
      <div className="flex h-7 overflow-hidden rounded-control">{groups.filter(g => g.value / (fc || 1) > 0.005).map(g => (
        <div key={g.name} className={`${g.tone} flex items-center justify-center text-[12px] font-bold text-white`} style={{ width: `${(g.value / (fc || 1)) * 100}%` }}>{Math.round((g.value / (fc || 1)) * 100)}%</div>))}</div>
      <div className="flex flex-col gap-2.5">{groups.map(g => (
        <div key={g.name} className="grid grid-cols-[12px_1fr_auto] items-start gap-2.5"><span className={`mt-1 size-3 rounded-sm ${g.tone}`} />
          <span><b>{g.name}</b><br /><span className="text-[13px] text-ink-muted">{g.what}</span></span><b className="tabular-nums">{fmtINR(g.value)}</b></div>))}
        {Math.abs(other) >= 1 && <div className="grid grid-cols-[12px_1fr_auto] gap-2.5"><span /><span className="text-[13px] text-ink-muted">December-only fix, rounding and other steps</span><span className="tabular-nums">{other > 0 ? '+' : '−'}{fmtINR(Math.abs(other))}</span></div>}
      </div>
      {note && <p className="text-[13px] text-ink-muted">{note}</p>}
      <div><Button variant="secondary" onClick={onDays}>Open its days ›</Button></div>
    </div></Card>
  )
}
