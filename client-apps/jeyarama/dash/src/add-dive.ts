// Adding a Dive to Dash (#1169): the rules the Report access page and its server share.

/** One of the organisation's Dives, as the Add a Dive card lists it. */
export interface DiveChoice {
  dive_id: string
  title: string
  /** The MotherDuck username of its owner. */
  owner: string
  /** The day it was last saved, ISO. */
  saved_on: string | null
  /** The name of the Dash report that opens it, or null. */
  in_dash: string | null
}

const DIVE_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** The Dive id in what was pasted: the id itself, or the last one in a Dive's link. Null for anything else. */
export function diveIdIn(pasted: string): string | null {
  const ids = pasted.match(new RegExp(DIVE_ID.source, 'gi'))
  return ids ? ids[ids.length - 1].toLowerCase() : null
}

/**
 * The Dives a search finds, newest saved first: the one a pasted link or id names, or those whose
 * title or owner holds every word typed.
 */
export function matchingDives(dives: readonly DiveChoice[], search: string): DiveChoice[] {
  const newest = [...dives].sort((a, b) => (b.saved_on ?? '').localeCompare(a.saved_on ?? '') || a.title.localeCompare(b.title, undefined, { numeric: true }))
  const id = diveIdIn(search)
  if (id) return newest.filter(dive => dive.dive_id.toLowerCase() === id)
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  return newest.filter(dive => words.every(word => `${dive.title} ${dive.owner}`.toLowerCase().includes(word)))
}

/** A new report's key: its name in lower case, words joined by dashes, numbered when taken. */
export function reportKeyFor(name: string, taken: readonly string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report'
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`
}
