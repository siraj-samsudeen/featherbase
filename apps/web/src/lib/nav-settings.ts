import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PanePlaceValue } from '@featherbase/shop-floor'
import { api } from './api'
import { decodeRecent, encodePath, rememberWalk, type NavPath } from './nav-path'

// #910 D2: what one person chose for walking between rows, kept in their
// server-side settings beside each list's (`/api/user_settings`), so it
// follows them across sign-ins and devices: where the drill pane sits, and
// their last ten walks — as identities, named afresh whenever shown.

/** The settings record that is not one Table's: the person's navigation. */
export const NAVIGATION_SETTINGS = '__navigation'

interface Stored {
  panePlace?: PanePlaceValue
  recentPaths?: unknown[]
}

const KEY = ['user-settings', NAVIGATION_SETTINGS]
const PLACES: PanePlaceValue[] = ['auto', 'right', 'bottom']

export function useNavigationSettings() {
  const queryClient = useQueryClient()
  const stored = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<{ settings: Stored | null }>(`/api/user_settings/${NAVIGATION_SETTINGS}`),
    retry: false,
    staleTime: Infinity,
  })
  const settings = stored.data?.settings ?? {}
  const save = (next: Stored) => {
    queryClient.setQueryData(KEY, { settings: { ...settings, ...next } })
    // A save merges into the person's record; one that fails keeps the
    // choice for this visit only.
    api.put(`/api/user_settings/${NAVIGATION_SETTINGS}`, next).catch(() => {})
  }
  const recent = decodeRecent(settings.recentPaths)
  return {
    ready: !stored.isPending,
    panePlace: PLACES.includes(settings.panePlace as PanePlaceValue) ? settings.panePlace! : 'auto',
    setPanePlace: (panePlace: PanePlaceValue) => save({ panePlace }),
    recent,
    /** Remembers the walk the person is on; unchanged walks are not saved again. */
    remember: (path: NavPath) => {
      const next = rememberWalk(recent, path)
      const encoded = next.map(encodePath)
      if (JSON.stringify(encoded) !== JSON.stringify(recent.map(encodePath))) save({ recentPaths: encoded })
    },
  }
}
