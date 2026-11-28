// Who carry_changes tells, and what (#1419; Siraj, 28-Nov-2026). After a new official Run loads, a subcategory whose
// Feather Forecast moved by more than 10% asks for its answer again (carry.ts); the people who had answered it on an
// earlier Run of the month, and the store's Store Manager, are told. Pure: the job reads, this decides.
import { MOVED_PCT } from './shared/carry'
import { inr } from './shared/model'

/** One subcategory whose Feather Forecast changed in the new load (the copy's moves() at threshold 0): its store and
 *  name, and its forecast in the previous load (null when it is new) and in this one. */
export interface Move { store_code: string; subcategory_name: string; before: number | null; after: number | null }
/** An answer given on an earlier Run, as forecast_line_review holds it, with the Feather Forecast it was given against. */
export interface PastAnswer { store_code: string; subcategory_name: string; reviewer: string; forecast_month: string | null; engine_value_before_tax: number | null }
export interface Notice { person: string; subject: string; body: string; path: string }

/** More than 10% away from the figure an answer was given against: the review's own test (carry.ts). */
const away = (from: number, to: number) => from !== 0 && Math.abs(to - from) * 100 > MOVED_PCT * Math.abs(from)

/** Who to tell, and what. An answer is asked for again when today's Feather Forecast is more than 10% from the one it
 *  was given against, exactly as the review decides (carry.ts); its writer is told on the load that first puts it
 *  there, so a later load that leaves it there tells no one again. The store's Store Managers hear of the same
 *  subcategories, in their own words. One notice per person; people are named on answers by their name, and
 *  `people` maps a name to the Person to notify (a name with no Person is left out). `storeManagers` names each
 *  store's Store Managers by Person (from their Employee row, #1438), so two managers who share a name are both told. */
export function noticesFor(moves: Move[], answers: PastAnswer[], month: string,
  people: Record<string, string>, storeManagers: Record<string, string[]>): Notice[] {
  const mine = new Map<string, string[]>(), team = new Map<string, string[]>()
  const add = (to: Map<string, string[]>, name: string, line: string) => { if (!to.has(name)) to.set(name, []); if (!to.get(name)!.includes(line)) to.get(name)!.push(line) }
  for (const m of moves) {
    if (m.after == null) continue
    for (const a of answers.filter(x => x.store_code === m.store_code && x.subcategory_name === m.subcategory_name && x.forecast_month?.slice(0, 7) === month.slice(0, 7))) {
      const given = a.engine_value_before_tax ?? m.before
      if (given == null || !away(given, m.after) || (m.before != null && away(given, m.before))) continue
      const line = `${m.subcategory_name}: ${inr(given)} → ${inr(m.after)}`
      add(mine, a.reviewer, line)
      for (const manager of storeManagers[m.store_code] ?? []) add(team, manager, `${line} (answered by ${a.reviewer})`)
    }
  }
  const subject = (lines: string[]) => (lines.length === 1 ? `Feather Forecast moved for ${lines[0].split(':')[0]}: answer again` : `Feather Forecast moved for ${lines.length} subcategories: answer again`)
  const notice = (person: string | undefined, lines: string[], body: string): Notice[] => (person ? [{ person, subject: subject(lines), body, path: '/forecasting/?view=section' }] : [])
  return [
    ...[...mine].flatMap(([name, lines]) => notice(people[name], lines,
      `The new official Run moved Feather Forecast by more than ${MOVED_PCT}% where you had answered:\n${lines.map(l => `- ${l}`).join('\n')}\nYour earlier answer no longer counts for these; please look again.`)),
    ...[...team].flatMap(([person, lines]) => notice(person, lines,
      `The new official Run moved Feather Forecast by more than ${MOVED_PCT}% where your store's team had answered:\n${lines.map(l => `- ${l}`).join('\n')}\nThose answers no longer count; the review asks for them again.`)
      .map(n => ({ ...n, subject: n.subject.replace(': answer again', ': your team answers again') }))),
  ]
}
