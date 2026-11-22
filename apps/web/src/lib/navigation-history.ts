import { useEffect, useState } from 'react'
import { api, getSessionUser } from './api'
import { connectEventSink, replaceServerEntries, type ServerRecentEntry } from './recents'

// #101 Phase 3 (#1385: here, so app pages send theirs too, not only the Admin): recorded actions also stream to the server's user_event log
// (batched; a beacon carries the final batch through unload). The sink is
// injected here so lib/recents stays network-free for unit tests. Auth rides
// the bearer token for fetches and the sid cookie for beacons — sendBeacon
// cannot set headers.
connectEventSink({
  // The queue fail-closes on this identity: only events recorded FOR this
  // user are ever posted with this user's credentials.
  currentUser: () => getSessionUser()?.row_id ?? null,
  post: (events, recorded) => {
    void api.post<{ timestamps: number[] }>('/api/events', { events }).then(
      ({ timestamps }) => {
        recorded(timestamps)
        window.dispatchEvent(new Event('navigation-history-updated'))
      },
    ).catch(
      () => {},
    )
  },
  beacon: (events) => {
    try {
      navigator.sendBeacon('/api/events', new Blob([JSON.stringify({ events })], { type: 'application/json' }))
    } catch {
      /* best-effort */
    }
  },
})

/** #101 / #1385: the person's navigation history, reconciled with the server each time a page's shell
 *  mounts. The command bar (on every page with a sidebar) starts the read; the Admin sidebar's Recently
 *  Opened and Frequent groups wait for the same one. Cached destinations are not offered until it settles;
 *  a failed read unlocks the untouched cache as a best-effort fallback. A read that a newer one has
 *  overtaken changes nothing, so a page left while its read is in flight never writes over the next. */
const state = { user: undefined as string | undefined, ready: false, read: 0 }
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

function readHistory(user: string) {
  const read = ++state.read
  state.user = user
  state.ready = false
  changed()
  const current = () => state.read === read
  api
    .get<{ entries: ServerRecentEntry[] }>('/api/events/summary')
    .then((res) => { if (current()) replaceServerEntries(user, res.entries) })
    .catch(() => {})
    .finally(() => {
      if (!current()) return
      state.ready = true
      changed()
    })
}

/** Whether `user`'s history has settled. `read`: this caller starts a new read when it mounts (the command
 *  bar does). Each update of the buffer draws the caller again. */
export function useNavigationHistory(user: string | undefined, read = false): boolean {
  const [, redraw] = useState(0)
  useEffect(() => {
    const again = () => redraw((version) => version + 1)
    listeners.add(again)
    window.addEventListener('navigation-history-updated', again)
    return () => {
      listeners.delete(again)
      window.removeEventListener('navigation-history-updated', again)
    }
  }, [])
  useEffect(() => {
    if (read && user) readHistory(user)
  }, [read, user])
  return Boolean(user && state.user === user && state.ready)
}
