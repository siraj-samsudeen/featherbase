// Who carry_changes tells, and what (#1419; Siraj, 28-Nov-2026). After a new official Run loads, a subcategory whose
// Feather Forecast moved by more than 10% asks for its answer again (carry.ts); the people who had answered it on an
// earlier Run of the month, and the store's Store Manager, are told. Pure: the job reads, this decides.
import { MOVED_PCT } from './shared/carry'
import { inr } from './shared/model'

/** One subcategory that moved, from the copy's moves(): its store and code, and Feather Forecast before and after. */
export interface Move { store_code: string; subcategory_code: string; before: number | null; after: number | null }
/** An answer given on an earlier Run, as forecast_line_review holds it. */
export interface PastAnswer { store_code: string; subcategory_name: string; reviewer: string; forecast_month: string | null }
export interface Notice { person: string; subject: string; body: string; path: string }

/** One notice per person, listing every subcategory of theirs that moved. People are named on answers by their
 *  name; `people` maps a name to the Person to notify, and a name with no Person is left out. */
export function noticesFor(moves: Move[], names: Record<string, string>, answers: PastAnswer[], month: string,
  people: Record<string, string>, storeManagers: Record<string, string[]>): Notice[] {
  const moved = moves.filter(m => m.before != null && m.after != null && m.before !== 0 && Math.abs(m.after - m.before) * 100 > MOVED_PCT * Math.abs(m.before))
  const lines = new Map<string, string[]>()
  const tell = (name: string, line: string) => { if (!lines.has(name)) lines.set(name, []); if (!lines.get(name)!.includes(line)) lines.get(name)!.push(line) }
  for (const m of moved) {
    const sub = names[`${m.store_code}:${m.subcategory_code}`]
    if (!sub) continue
    const line = `${sub}: ${inr(m.before!)} → ${inr(m.after!)}`
    for (const a of answers.filter(x => x.store_code === m.store_code && x.subcategory_name === sub && x.forecast_month?.slice(0, 7) === month.slice(0, 7))) tell(a.reviewer, line)
    for (const manager of storeManagers[m.store_code] ?? []) tell(manager, line)
  }
  return [...lines].flatMap(([name, moved]) => people[name] ? [{
    person: people[name],
    subject: moved.length === 1 ? `Feather Forecast moved for ${moved[0].split(':')[0]}: answer again` : `Feather Forecast moved for ${moved.length} subcategories: answer again`,
    body: `The new official Run moved Feather Forecast by more than ${MOVED_PCT}% where you had answered:\n${moved.map(l => `- ${l}`).join('\n')}\nYour earlier answer no longer counts for these; please look again.`,
    path: '/forecasting/?view=section',
  }] : [])
}
