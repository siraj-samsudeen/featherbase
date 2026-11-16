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

/** Remembers the list's filters now on (none included: a list cleared of its
 *  filters opens unfiltered next time). */
export function rememberFilters(table: string, filters: Filter[]): void {
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
 *  Each arrival at a bare open is its own visit with its own read, including on
 *  the same Table without the list unmounting (a filtered link, then the
 *  sidebar's bare one): an earlier visit's answer is never reused. A read waits
 *  for any save still queued, so it never brings back older filters. */
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
    if (!fresh) return
    let live = true
    filtersWrite
      .then(() => api.get<{ settings: { filters?: unknown } | null }>(settingsPath(table)))
      .then((res) => {
        // Read back through the address's own parser, so a stored value that is
        // not a list of filters reads as none.
        const stored = res.settings?.filters
        if (live) setAnswer({ table, visit, filters: Array.isArray(stored) ? (parseFilters(JSON.stringify(stored)) as Filter[]) : [] })
      })
      .catch(() => { if (live) setAnswer({ table, visit, filters: [] }) })
    return () => { live = false }
  }, [table, fresh, visit])
  if (!fresh) return []
  return answer && answer.table === table && answer.visit === visit ? answer.filters : undefined
}
