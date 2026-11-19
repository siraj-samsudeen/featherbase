// Turns a plan into figures. Every figure comes from Dash's own `report` read, called as the signed-in
// person: the same read, role check and reach as opening the report, so Ask can show nothing the report
// would refuse. Prototype: locally that read serves the made-up cached copy; live, it is the warehouse.
import { fmtDate, fmtINR, fmtPct } from '@featherbase/shop-floor'
import { readApp, type Plan } from './api'

interface Totals { target: number | null; actual: number | null; gap: number | null }
interface Report { state: string; store: string; store_name: string | null; period_start: string; data_through: string | null; refreshed_at: string | null
  rows: (Totals & { code: string; subcategory: string | null; section: string | null; noTargetNoSale: boolean })[]
  sections: (Totals & { section: string | null })[]; total: Totals }
export interface Line { key: string; name: string; store?: string; target: number | null; actual: number | null; gap: number | null; achieved: number | null }
export interface Figures { sentence: string; lines: Line[]; label: string; covers: string; through: string | null; refreshed: string | null; notes: string[]; href: string; more: number }

const achieved = (t: Totals) => (t.target && t.actual != null ? (t.actual / t.target) * 100 : null)
const line = (key: string, name: string, t: Totals, store?: string): Line => ({ key, name, store, target: t.target, actual: t.actual, gap: t.gap, achieved: achieved(t) })
const sum = (list: Totals[]): Totals => {
  const add = (pick: (t: Totals) => number | null) => (list.some(t => pick(t) != null) ? list.reduce((s, t) => s + (pick(t) ?? 0), 0) : null)
  const target = add(t => t.target), actual = add(t => t.actual)
  return { target, actual, gap: target != null && actual != null ? actual - target : null }
}
const NOT_READY: Record<string, string> = { no_data_yet: "this month's figures haven't arrived yet", not_built: 'its figures are being prepared', unconfirmed: 'its figures are being prepared', no_access: 'you may not open it' }

export async function figures(plan: Plan, stores: { value: string; label: string }[]): Promise<Figures> {
  const chosen = (plan.stores === 'all' ? stores : stores.filter(s => plan.stores.includes(s.value))).slice(0, 12)
  if (!chosen.length) throw new Error('Your job covers no store on this report, so there are no figures to show.')
  const answers = await Promise.all(chosen.map(store => readApp<Report>('dash', 'report', { report: 'sales', store: store.value, month: plan.month })
    .then(report => ({ store, report }), () => ({ store, report: { state: 'no_access' } as Report }))))
  const ready = answers.filter(a => a.report.state === 'ready')
  const notes = answers.filter(a => a.report.state !== 'ready').map(a => `${a.store.label}: ${NOT_READY[a.report.state] ?? 'no figures'}`)
  const many = ready.length > 1
  const when = plan.month === 'last' ? 'last month' : 'this month'
  const covers = ready.map(a => a.store.label).join(', ')
  const base = { covers, notes, through: ready.map(a => a.report.data_through).filter(Boolean).sort()[0] ?? null,
    refreshed: ready.map(a => a.report.refreshed_at).filter(Boolean).sort()[0] ?? null,
    href: `/dash/?report=sales${ready[0] ? `&store=${encodeURIComponent(ready[0].store.value)}` : ''}${plan.month === 'last' ? '&month=last' : ''}` }
  if (!ready.length) return { ...base, sentence: `There are no figures to show for ${when} yet.`, lines: [], label: 'Store', more: 0 }

  const total = sum(ready.map(a => a.report.total))
  const pct = achieved(total)
  const place = many ? `Your ${ready.length} stores are` : `${covers} is`
  const headline = pct == null ? `${place} at ${fmtINR(total.actual)} in sales ${when}; no target is recorded.`
    : `${pct >= 100 ? 'Yes.' : 'Not yet.'} ${place} at ${fmtPct(pct)} of target ${when}: ${fmtINR(total.actual)} sold against ${fmtINR(total.target)}, ${fmtINR(Math.abs(total.gap ?? 0))} ${(total.gap ?? 0) >= 0 ? 'ahead' : 'behind'}.`

  let lines: Line[], label = 'Subcategory', sentence = headline
  if (plan.group_by === 'store' || (plan.group_by === 'none' && many)) { label = 'Store'; lines = ready.map(a => line(a.store.value, a.store.label, a.report.total)) }
  else if (plan.group_by === 'section') { label = 'Section'; lines = ready.flatMap(a => a.report.sections.map(s => line(`${a.store.value}-${s.section}`, s.section ?? 'No section', s, a.store.label))) }
  else lines = ready.flatMap(a => a.report.rows.filter(r => !r.noTargetNoSale).map(r => line(`${a.store.value}-${r.code}`, r.subcategory ?? r.code, r, a.store.label)))

  const asked = plan.group_by !== 'none'
  // "Did I meet my target" gets the total as its sentence, and the subcategories furthest behind as its small table.
  const show = asked ? plan.show : label === 'Subcategory' ? 'behind' : 'all'
  if (plan.name_contains) lines = lines.filter(l => l.name.toLowerCase().includes(plan.name_contains!.toLowerCase()))
  if (show === 'behind') lines = lines.filter(l => (l.gap ?? 0) < 0)
  if (show === 'ahead') lines = lines.filter(l => (l.gap ?? 0) > 0)
  const value = (l: Line) => (asked ? { gap: l.gap, achieved: l.achieved, actual: l.actual, target: l.target }[plan.sort] : l.gap) ?? (plan.order === 'desc' ? -Infinity : Infinity)
  const direction = asked && plan.order === 'desc' ? -1 : 1
  lines.sort((a, b) => (value(a) - value(b)) * direction)
  const limit = asked ? plan.limit ?? 25 : label === 'Store' ? 25 : 5
  const more = Math.max(0, lines.length - limit)
  lines = lines.slice(0, limit)

  if (asked && lines.length) {
    const noun = `${label.toLowerCase().replace(/y$/, 'ie')}s`.replace('subcategorys', 'subcategories')
    const top = lines[0]
    const where = many ? `across ${ready.length} stores` : `at ${covers}`
    sentence = show === 'behind' ? `${lines.length + more} ${noun} are behind target ${where} ${when}. ${top.name} is furthest behind, by ${fmtINR(Math.abs(top.gap ?? 0))}.`
      : show === 'ahead' ? `${lines.length + more} ${noun} are ahead of target ${where} ${when}. ${top.name} leads, by ${fmtINR(Math.abs(top.gap ?? 0))}.`
      : `Here are the ${noun} ${where} ${when}. Overall: ${fmtPct(pct)} of target.`
  } else if (asked) sentence = `Nothing matches that ${many ? 'in your stores' : `at ${covers}`} ${when}.`
  return { ...base, sentence, lines, label, more }
}
export const throughLine = (f: Figures) => [`Covers ${f.covers || 'no store'}`, f.through && `Figures through ${fmtDate(f.through)}`].filter(Boolean).join(' · ')

/** The figures as the person would read them, for the AI to put into words: formatted here, so it copies and never recalculates. */
export function facts(f: Figures): string {
  const rows = f.lines.slice(0, 40).map(l => `${l.name}${l.store ? ` (${l.store})` : ''}: target ${fmtINR(l.target)}, sales ${fmtINR(l.actual)}, gap ${fmtINR(l.gap, { signed: true })}, achieved ${fmtPct(l.achieved)}`)
  return [`Summary: ${f.sentence}`, `${f.label} rows shown (${f.lines.length}${f.more ? `, ${f.more} more not shown` : ''}):`, ...rows, throughLine(f), ...f.notes].join('\n')
}
