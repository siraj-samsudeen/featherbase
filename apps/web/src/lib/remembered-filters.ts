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
 *  shows what its address says, so the answer is `[]` at once. */
export function useRememberedFilters(table: string, fresh: boolean): Filter[] | undefined {
  const [answer, setAnswer] = useState<{ table: string; filters: Filter[] } | undefined>(
    fresh ? undefined : { table, filters: [] },
  )
  useEffect(() => {
    if (!fresh) return
    let live = true
    api
      .get<{ settings: { filters?: unknown } | null }>(settingsPath(table))
      .then((res) => {
        // Read back through the address's own parser, so a stored value that is
        // not a list of filters reads as none.
        const stored = res.settings?.filters
        if (live) setAnswer({ table, filters: Array.isArray(stored) ? (parseFilters(JSON.stringify(stored)) as Filter[]) : [] })
      })
      .catch(() => { if (live) setAnswer({ table, filters: [] }) })
    return () => { live = false }
    // Asked once per Table and open: later changes are the person's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table])
  return answer?.table === table ? answer.filters : fresh ? undefined : []
}
