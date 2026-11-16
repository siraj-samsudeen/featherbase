import { useEffect, useState } from 'react'
import { parseFilters } from 'shared'
import { api, getToken } from './api'

// #1228: a Table's list remembers the person's last filters, beside its sort
// and columns (UI-013), in the same server-side record, so they follow the
// person across sign-ins and devices. The server merges a save's top-level
// keys into the record, so this save and ListView's never drop each other's.

type Filter = [string, string, unknown]
const settingsPath = (table: string) => `/api/user_settings/${encodeURIComponent(table)}`

/** Saves are queued in interaction order, as ListView's are: a slower earlier
 *  save cannot land after a newer one and bring back older filters. */
let filtersWrite: Promise<unknown> = Promise.resolve()

/** What this tab last read or saved for a person's list of a Table. Every
 *  change made in this tab passes through rememberFilters, so a bare open can
 *  decide at once from it, with no wait and no empty page; only a Table not
 *  yet seen in this tab waits for the server's answer. */
const known = new Map<string, Filter[]>()
const knownKey = (table: string) => `${getToken() ?? ''}\u0000${table}`
/** Each save in this tab counts up its Table's version, so a read that started
 *  before a save can never overwrite what was saved (Codex review, round 8). */
const saves = new Map<string, number>()

/** Remembers the list's filters now on (none included: a list cleared of its
 *  filters opens unfiltered next time). */
export function rememberFilters(table: string, filters: Filter[]): void {
  known.set(knownKey(table), filters)
  saves.set(knownKey(table), (saves.get(knownKey(table)) ?? 0) + 1)
  const token = getToken()
  filtersWrite = filtersWrite
    .then(() => {
      // A queued save belongs to the sign-in that made it.
      if (getToken() !== token) return
      return api.put(settingsPath(table), { filters })
    })
    .catch(() => {})
}

/** On a fresh open (no filters and no walk in the address), the remembered
 *  filters, once known: `undefined` while asking, `[]` for none. Any other open
 *  shows what its address says, so the answer is `[]` at once.
 *
 *  Each arrival at a bare open is its own visit, including on the same Table
 *  without the list unmounting (a filtered link, then the sidebar's bare one).
 *  It is decided at once from what this tab last read or saved for the Table
 *  (every change here passes through rememberFilters), so returning to a list
 *  shows it with no wait; a Table not yet seen in this tab is read from the
 *  server, after any save still queued. A change made on another device shows
 *  on the next page load. */
export function useRememberedFilters(table: string, fresh: boolean): Filter[] | undefined {
  // The visit: counted up each time the address becomes a bare open (derived
  // during render, so no frame ever sees the previous visit's answer).
  const [seen, setSeen] = useState({ table, fresh, visit: 0 })
  let visit = seen.visit
  if (seen.table !== table || seen.fresh !== fresh) {
    visit = fresh ? seen.visit + 1 : seen.visit
    setSeen({ table, fresh, visit })
  }
  const [answer, setAnswer] = useState<{ table: string; visit: number; filters: Filter[] } | undefined>()
  useEffect(() => {
    // Known in this tab: decided already, with no read.
    if (!fresh || known.has(knownKey(table))) return
    let live = true
    const key = knownKey(table)
    const before = saves.get(key) ?? 0
    filtersWrite
      .then(() => api.get<{ settings: { filters?: unknown } | null }>(settingsPath(table)))
      .then((res) => {
        // Read back through the address's own parser, so a stored value that is
        // not a list of filters reads as none.
        const stored = res.settings?.filters
        const filters = Array.isArray(stored) ? (parseFilters(JSON.stringify(stored)) as Filter[]) : []
        // Only a read still wanted, with no save since it began, says what is known.
        if (!live || (saves.get(key) ?? 0) !== before) return
        known.set(key, filters)
        setAnswer({ table, visit, filters })
      })
      .catch(() => { if (live) setAnswer({ table, visit, filters: [] }) })
    return () => { live = false }
  }, [table, fresh, visit])
  if (!fresh) return []
  if (answer && answer.table === table && answer.visit === visit) return answer.filters
  return known.get(knownKey(table))
}
