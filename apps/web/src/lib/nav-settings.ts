import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { PanePlaceValue } from '@featherbase/shop-floor'
import { api, getToken } from './api'
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
  /** #1229: others' shared saved views this person put in their sidebar. */
  starredViews?: string[]
}

/** The Admin sidebar's saved views (GET /api/saved_views/sidebar), under the
 *  saved-views prefix every view change invalidates. */
export const SIDEBAR_VIEWS_KEY = ['saved-views', '__sidebar'] as const

/** After any change to saved views (save, share, delete, star): every saved-view
 *  read, the sidebar's included, asks again. A read still pending is cancelled
 *  first: invalidation would reuse it, and its answer from before the change
 *  could hide the change (Codex review, round 3). */
export async function refreshSavedViews(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: ['saved-views'] })
  await queryClient.invalidateQueries({ queryKey: ['saved-views'] })
}

const KEY = ['user-settings', NAVIGATION_SETTINGS]

// Saves carry whole snapshots (every recent walk), and every pane and path
// bar holds this hook, so one chain for them all keeps the writes in
// interaction order, as ListView's persist does: a slower earlier save
// cannot land after a newer one and bring back an older walk.
let settingsWrite: Promise<unknown> = Promise.resolve()
const PLACES: PanePlaceValue[] = ['auto', 'right', 'bottom']

export function useNavigationSettings() {
  const queryClient = useQueryClient()
  const stored = useQuery({
    queryKey: KEY,
    // `read` marks data the server answered: a save's optimistic write carries
    // it forward and never invents it (Codex review, round 4).
    queryFn: async () => ({ ...(await api.get<{ settings: Stored | null }>(`/api/user_settings/${NAVIGATION_SETTINGS}`)), read: true }),
    retry: false,
    staleTime: Infinity,
  })
  const settings = stored.data?.settings ?? {}
  const save = (next: Stored) => {
    queryClient.setQueryData(KEY, { settings: { ...settings, ...next }, read: stored.data?.read === true })
    // A save merges into the person's record; one that fails keeps the
    // choice for this visit only.
    const token = getToken()
    settingsWrite = settingsWrite
      .then(() => {
        // A queued save belongs to the sign-in that made it.
        if (getToken() !== token) return
        return api.put(`/api/user_settings/${NAVIGATION_SETTINGS}`, next)
      })
      .catch(() => {})
  }
  const recent = decodeRecent(settings.recentPaths)
  const starredViews = Array.isArray(settings.starredViews) ? settings.starredViews.filter((id) => typeof id === 'string') : []
  return {
    starredViews,
    /** #1229: puts another person's shared view in the sidebar, or takes it out. */
    /** Stars can be changed only once the person's settings have been read:
     *  before that (or after a failed read) the list is unknown, and a save
     *  would overwrite the stars they have (Codex review, round 3). */
    starsLoaded: stored.data?.read === true,
    toggleStar: (view: string) => {
      if (stored.data?.read !== true) return
      const next = starredViews.includes(view) ? starredViews.filter((id) => id !== view) : [...starredViews, view]
      save({ starredViews: next })
      // The sidebar's list reads the stars on the server: ask again once saved.
      void settingsWrite.then(() => refreshSavedViews(queryClient))
    },
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
