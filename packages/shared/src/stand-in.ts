// #1409: stand-in datasets. A dataset served from a file until the warehouse
// has its data is marked on every response that carried its rows: the server
// names them in one header, and the page shell reads it and draws the line.
// Both sides use these, so the wire format cannot drift.

/** One dataset whose stand-in rows a response carried. */
export interface StandInServed {
  app: string
  dataset: string
  /** When the stand-in was loaded, as an ISO instant. */
  loaded_at: string
  note: string | null
  /** The day the real data is expected (YYYY-MM-DD), when one is set. */
  expected_by: string | null
}

/** The response header naming the stand-ins a response's rows came from. */
export const STAND_IN_HEADER = 'Featherbase-Stand-In'

/** The header's value: the list as JSON, percent-encoded so a note in any
 *  script travels in a header. */
export function standInHeaderValue(standIns: readonly StandInServed[]): string {
  return encodeURIComponent(JSON.stringify(standIns))
}

const isStandIn = (value: unknown): value is StandInServed => {
  const s = value as StandInServed | null
  return !!s && typeof s.app === 'string' && typeof s.dataset === 'string' && typeof s.loaded_at === 'string'
}

/** The stand-ins a header names; none for a missing or unreadable header. */
export function readStandInHeader(value: string | null | undefined): StandInServed[] {
  if (!value) return []
  try {
    const list: unknown = JSON.parse(decodeURIComponent(value))
    return Array.isArray(list) ? list.filter(isStandIn) : []
  } catch {
    return []
  }
}
