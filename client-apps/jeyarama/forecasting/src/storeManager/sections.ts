// The Store Manager's sections (the agreed prototype): each Team Leader's section with how far its review has got,
// the Section Board's order, and which tree nodes open when the page is scoped. Pure; the page draws them.
import { hash, type SectionInfo } from '../shared/madeUpChain'
import { combine, type Group, type Line } from '../shared/model'
import { SORTERS, type SortKey } from '../shared/MeasureTable'
import { pathTo, type Level } from '../shared/levels'

/** How many of a section's n subcategories its Team Leader has answered; null when the section has no Team Leader.
 *  On the made-up chain a steady sample (the prototype's `answered`); on a real Run what the app holds, none yet,
 *  until the review reads forecast_line_review (#1418). */
export function answeredIn(section: string, n: number, teamLeader: string | undefined, madeUp = true): number | null {
  if (!teamLeader) return null
  if (!madeUp) return 0
  const f = hash(section)
  return f < 0.3 ? n : f < 0.45 ? 0 : Math.max(1, Math.round(n * f))
}

export interface SectionSummary {
  name: string; teamLeader: string | undefined; lines: Line[]; item: Group
  /** Subcategories answered (null: no Team Leader). */
  answered: number | null
}

/** The sections the lines fall in, each summed, with its Team Leader and progress. */
export function sectionsOf(lines: Line[], info: SectionInfo[], madeUp = true): SectionSummary[] {
  const names = [...new Set(lines.map(l => l.section))]
  return names.map(name => {
    const mine = lines.filter(l => l.section === name)
    const teamLeader = info.find(s => s.section === name)?.teamLeader
    return { name, teamLeader, lines: mine, item: combine(mine, -1, name), answered: answeredIn(name, mine.length, teamLeader, madeUp) }
  })
}

/** Sections whose every subcategory is answered. */
export const fullyAnswered = (secs: SectionSummary[]) => secs.filter(s => s.answered != null && s.answered === s.lines.length).length

/** A section's muted line: "Asha · 3/8 answered", or "No Team Leader · 8 subcategories". */
export const sectionLine = (s: Pick<SectionSummary, 'teamLeader' | 'answered' | 'lines'>) =>
  s.teamLeader ? `${s.teamLeader} · ${s.answered}/${s.lines.length} answered` : `No Team Leader · ${s.lines.length} subcategories`

/** The Section Board's order: furthest behind AOP, biggest change on last year, or biggest first. */
export const boardOrder = (secs: SectionSummary[], sort: SortKey) => [...secs].sort((a, b) => SORTERS[sort](a.item, b.item))

/** How full a board tile's meter is (0–100), Feather Forecast against AOP with the 100% mark at 80% of the bar. */
export const meterWidth = (o: { fc: number; aop: number }) => (o.aop ? Math.min(100, o.fc / o.aop * 80) : 0)

/** The tree nodes to open for a scope (the prototype's focusScope): every level the lines share, and, when the
 *  scope leaves only a few subcategories, the whole way down to each of them. */
export function focusOpen(lines: Line[], levels: Level[], scoped: boolean, few = 40): Set<string> {
  const open = new Set<string>()
  const keys: string[] = []
  for (const lv of levels) {
    const ks = new Set(lines.map(lv.key))
    if (ks.size !== 1) break
    keys.push([...ks][0])
    open.add(keys.join(' › '))
  }
  if (scoped && lines.length <= few) for (const l of lines) pathTo(l, levels).forEach(id => open.add(id))
  return open
}
