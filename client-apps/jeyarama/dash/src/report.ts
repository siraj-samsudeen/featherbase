// The report page's rules shared by Dash's reads: the reader's heading in one store, the month
// choices and their periods in India time, and the store picker's labels.
import { sectionLabel, type Place } from './provider.ts'

/** The month a reader chose (#750): this month to date, or last month whole. */
export type MonthChoice = 'this' | 'last'
export const MONTH_CHOICES: readonly MonthChoice[] = ['this', 'last']

/** One reason the reader sees the store: a basis on their places there, and the sections those places name. */
export interface Reason { basis: string; sections: string[] }

/** The page's header for one store: its short name (null when unknown), its sections, and why the reader sees it. */
export interface Heading { name: string | null; sections: string[]; reasons: Reason[] }

/**
 * The reader's reasons in one store, from their places there: each basis a place carries (the
 * provider joins several with ", "), with the sections of the places carrying it. A place named
 * by the store itself (a whole store, or subcategories outside the map) adds no section.
 */
export function headingOf(places: readonly Place[], store: string, name: string | null): Heading {
  const prefix = sectionLabel(store, '')
  const sections = new Set<string>()
  const byBasis = new Map<string, Set<string>>()
  for (const place of places) {
    if (!(place.filters.store ?? []).includes(store)) continue
    const section = place.label.startsWith(prefix) ? place.label.slice(prefix.length) : null
    if (section) sections.add(section)
    for (const basis of (place.basis ?? '').split(',').map(b => b.trim()).filter(Boolean)) {
      const named = byBasis.get(basis) ?? new Set<string>()
      if (section) named.add(section)
      byBasis.set(basis, named)
    }
  }
  const sorted = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b))
  return { name, sections: sorted(sections),
    reasons: [...byBasis].sort(([a], [b]) => a.localeCompare(b)).map(([basis, named]) => ({ basis, sections: sorted(named) })) }
}

/** Today in India Standard Time. */
export function istToday(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10)
}

/**
 * The period of a month choice (#750): this month to date, the first of the month through today;
 * or last month whole, its first day through its last.
 */
export function periodOf(today: string, month: MonthChoice = 'this') {
  if (month === 'this') return { period_start: `${today.slice(0, 8)}01`, period_end: today }
  const first = new Date(`${today.slice(0, 8)}01T00:00:00Z`)
  const last = new Date(first.getTime() - 86_400_000)
  return { period_start: `${last.toISOString().slice(0, 8)}01`, period_end: last.toISOString().slice(0, 10) }
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** An ISO day as people read it, DD-Mon-YYYY ("01-Apr-2026"); the server's own, so it carries no page code. */
export function dayLabel(day: string): string {
  return `${day.slice(8, 10)}-${MONTH_NAMES[Number(day.slice(5, 7)) - 1]}-${day.slice(0, 4)}`
}

/** A month as people read it, Mon'YY ("Nov'26"), from any ISO day in it. */
export function monthLabel(day: string): string {
  return `${MONTH_NAMES[Number(day.slice(5, 7)) - 1]}'${day.slice(2, 4)}`
}

const BY_NAME = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/**
 * The bar's store picker labels: each store by its name alone, never its plant code, A–Z by name
 * (#1153: no code is shown, so an order by code looked random). A store with no name known goes by
 * "Your store" (the reader's only store) or "Store 1", "Store 2", after the named ones. Stores
 * sharing a name are numbered ("Lakeside (1)").
 */
export function storeLabels(stores: readonly string[], names: ReadonlyMap<string, string>) {
  const base = stores.map((store, i) => names.get(store) ?? (stores.length === 1 ? 'Your store' : `Store ${i + 1}`))
  const labelled = stores.map((store, i) => {
    const twins = stores.filter((_, j) => base[j] === base[i])
    return { value: store, label: twins.length > 1 ? `${base[i]} (${twins.indexOf(store) + 1})` : base[i], named: names.has(store) }
  })
  return labelled.sort((a, b) => Number(b.named) - Number(a.named) || (a.named ? BY_NAME.compare(a.label, b.label) : 0))
    .map(({ value, label }) => ({ value, label }))
}
