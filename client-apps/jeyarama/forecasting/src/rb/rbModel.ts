// The RB review's own logic (the agreed prototype rb_review.template.html): its levels, the breadcrumb, where a
// search scope puts you, and the made-up review progress per store. Pure functions; RbReview.tsx draws them.
import { hash, type SectionInfo } from '../shared/madeUpChain'
import type { Line } from '../shared/model'
import { LEVEL, pathTo, type Level } from '../shared/levels'

/** Inside a store: as it is bought (Division › Subdivision › Category) or by Team Leader section. */
export type InsideStore = 'category' | 'section'

/** Store › (Division › Subdivision › Category | Section); the subcategories are the leaves. A section shows its Team Leader. */
export function rbLevels(by: InsideStore, sections: SectionInfo[]): Level[] {
  // no Region level: the page's Region toggle picks the region (owner, 27-Nov-2026), so the tree starts at the store
  if (by === 'category') return [LEVEL.store, LEVEL.division, LEVEL.subdivision, LEVEL.category]
  const leader = new Map(sections.map(s => [`${s.store}|${s.section}`, s.teamLeader]))
  return [LEVEL.store, { ...LEVEL.section, subLabel: n => leader.get(`${n.lines[0]?.store}|${n.label}`) }]
}

/** The lines under a breadcrumb (the keys walked down, top first). */
export const linesAt = (lines: Line[], levels: Level[], crumb: string[]) =>
  lines.filter(l => crumb.every((k, i) => !levels[i] || levels[i].key(l) === k))

export interface CrumbStep { label: string; at: number; current: boolean }
/** "Kerala › LKS Lakeside › Fashion": the region picked, then each step; how many keys each keeps when clicked; the
 *  last is where you are. */
export function crumbSteps(crumb: string[], storeName: (code: string) => string | undefined, root: string): CrumbStep[] {
  const words = [root, ...crumb.map((k, i) => (i === 0 ? [k, storeName(k)].filter(Boolean).join(' ') : k))]
  return words.map((label, at) => ({ label, at, current: at === words.length - 1 }))
}

/** What to do next at a breadcrumb: go down a level, or open a subcategory. */
export const crumbHint = (crumb: string[], levels: Level[]) =>
  crumb.length < levels.length ? `click a row to go down to ${levels[crumb.length].name.toLowerCase()}` : 'click a subcategory for how Feather Forecast built it'

/** The node ids from the top down to a node (the breadcrumb as tree ids: "Kerala", "Kerala › LKS"). */
export const idsOf = (keys: string[]) => keys.map((_, i) => keys.slice(0, i + 1).join(' › '))

/** Open the tree to a scope (the prototype's focusScope): every level the scoped lines share, and, when a scope
 *  holds 40 lines or fewer, every path down to them. The breadcrumb follows the shared levels. */
export function focusScope(lines: Line[], levels: Level[], scoped: boolean): { open: Set<string>; crumb: string[] } {
  const crumb: string[] = []
  for (const lv of levels) {
    const ks = new Set(lines.map(lv.key))
    if (ks.size !== 1) break
    crumb.push([...ks][0])
  }
  const open = new Set(idsOf(crumb))
  if (scoped && lines.length <= 40) for (const l of lines) pathTo(l, levels).forEach(id => open.add(id))
  return { open, crumb: scoped ? crumb : [] }
}

// ---- review progress per store (made up and steady until the app records answers) ------------------------
export interface StoreProgress {
  store: string; storeName: string; region: string
  /** Subcategories at the store (before folding). */
  lines: number
  /** % of subcategories the Team Leaders have answered (made up). */
  answered: number
  /** Proposals waiting with the Store Manager (from the review). */
  waiting: number
  /** Days the oldest has waited (made up). */
  oldest: number
  /** Questions open (made up). */
  questions: number
}
/** Each store's review progress. On the made-up chain answered, oldest and questions are steady samples; on a real
 *  Run they are what the app holds, none yet (#1418). */
export function storeProgress(lines: Line[], waitingIn: (lines: Line[]) => number, madeUp = true): StoreProgress[] {
  const stores = [...new Set(lines.map(l => l.store))]
  return stores.map(store => {
    const mine = lines.filter(l => l.store === store), l = mine[0]
    return {
      store, storeName: l.storeName, region: l.region, lines: mine.reduce((t, x) => t + x.n, 0),
      answered: madeUp ? Math.round((0.25 + hash(`${store}p`) * 0.7) * 100) : 0, waiting: waitingIn(mine),
      oldest: madeUp ? 1 + Math.round(hash(`${store}o`) * 3) : 0, questions: madeUp ? Math.round(hash(`${store}q`) * 2.4) : 0,
    }
  }).sort((a, b) => b.waiting - a.waiting || a.store.localeCompare(b.store))
}
