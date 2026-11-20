import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { replaceServerEntries, type ServerRecentEntry } from './recents'

/** #101 / #1385: the person's navigation history, reconciled with the server
 *  once per page. The command bar and the Admin sidebar's Recently Opened and
 *  Frequent groups read the same per-person buffer (lib/recents), so they share
 *  this one request. Cached destinations are not offered until the summary
 *  settles; a failed request unlocks the untouched cache as a best-effort
 *  fallback. Each update of the buffer draws the caller again. */
export function useNavigationHistory(user: string | undefined): boolean {
  const [, refresh] = useState(0)
  useEffect(() => {
    const redraw = () => refresh((version) => version + 1)
    window.addEventListener('navigation-history-updated', redraw)
    return () => window.removeEventListener('navigation-history-updated', redraw)
  }, [])
  const summary = useQuery({
    queryKey: ['navigation-history', user],
    queryFn: async () => {
      try {
        const res = await api.get<{ entries: ServerRecentEntry[] }>('/api/events/summary')
        replaceServerEntries(user!, res.entries)
      } catch {
        /* the cache stays as it was */
      }
      return true
    },
    enabled: Boolean(user),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  return Boolean(user && summary.isSuccess)
}
