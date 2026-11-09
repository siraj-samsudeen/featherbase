import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { rowHref, tableHref } from 'shared'
import { EMPTY_PATH, decodePath, encodePath, go as goTo, push as pushStep, replace as replaceAt, stepShows, type NavPath, type NavStep } from './nav-path'

// #910 D1: where the user is on their walk between related rows. The list
// and row pages keep the path in their address (`?path=`), so every drill and
// filter is a browser history entry and a shareable link; other screens
// (Explore) keep one in memory. Screens read and move it through this
// context; a screen outside any provider simply has no path.

interface Walk {
  path: NavPath
  /** The step on screen. */
  step: NavStep
  /** A new step after the current one: every drill and every filter. */
  push: (step: NavStep) => void
  /** Changes the step on screen without adding one: the open group, the tab, the tree's expansion. */
  replace: (step: NavStep) => void
  /** Puts a whole path on screen (a recent path). */
  open: (path: NavPath) => void
  /** Rewrites the path and moves one step on along it: the step before the
   *  new current one takes this history entry and the new one adds an entry,
   *  so the browser's back button lands on the step before it on the path. */
  advanceTo: (path: NavPath) => void
}

/** The walk of a list or row page, kept in its address (and so shareable).
 *  Only these pages draw the path bar and the row page's tree. */
export interface AddressNavigation extends Walk {
  addressed: true
  /** Moves to step `index` of the path. */
  go: (index: number) => void
  /** The address of a path on the page that shows its current step, for links. */
  href: (path: NavPath) => string
  /** Unfolds or folds the tree on screen. The step keeps what was unfolded
   *  when it was taken; later changes stay on the page and go into the next
   *  step taken from it, so an earlier step brings back its own tree. */
  setExpanded: (expanded: string[]) => void
}

/** The walk of a screen with no address of its own (Explore's drill pane). */
export interface LocalNavigation extends Walk {
  addressed: false
}

export type Navigation = AddressNavigation | LocalNavigation

const NavigationContext = createContext<Navigation | null>(null)

export const useNavigation = () => useContext(NavigationContext)

/** The walk, for what only a list or row page draws (the path bar, the row
 *  page's tree): there it is always the address's walk, or none. */
export const usePageNavigation = () => useContext(NavigationContext) as AddressNavigation | null

export function NavigationProvider({ value, children }: { value: Navigation; children: ReactNode }) {
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

/** Whether a step shows this screen: the same page of the same Table (and row). */
export function sameScreen(a: NavStep, b: NavStep): boolean {
  return a.screen === b.screen && a.table === b.table && (a.screen !== 'row' || a.row === b.row)
}

/** The page address that shows a path's current step. */
export function pathHref(path: NavPath): string {
  const step = path.steps[path.at]
  const base = step.screen === 'row' ? rowHref(step.table, step.row!) : tableHref(step.table)
  return `${base}?path=${encodeURIComponent(encodePath(path))}`
}

/**
 * The navigation of a list or row page, kept in its `path` search param.
 * `here` is the page itself: when the address carries no path, or one whose
 * current step is another page, the walk starts here.
 */
/** The whole path the path's Back is moving to through history, until it arrives. */
let arriving: NavPath | null = null

export function useAddressNavigation(here: NavStep, raw: unknown): Navigation {
  const navigate = useNavigate()
  const decoded = useMemo(() => decodePath(raw), [raw])
  const hereKey = JSON.stringify(here)
  const path = useMemo<NavPath>(() => {
    if (decoded && sameScreen(decoded.steps[decoded.at], here)) return decoded
    return pushStep(EMPTY_PATH, here)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, hereKey])
  // How many history entries before this one belong to this walk, one per
  // step: the path's Back then moves back through them, so the browser's back
  // and forward keep walking exactly the path's steps. A walk opened from a
  // link or a recent path starts at 0 and has none behind it.
  const router = useRouter()
  const depth = useRouterState({ select: (s) => (s.location.state as { navDepth?: number }).navDepth ?? 0 })
  const show = useCallback((next: NavPath, replace = false, from = depth) => {
    if (next === path) return
    const navDepth = replace ? from : from + 1
    void navigate({ href: pathHref(next), replace, state: ((was: object) => ({ ...was, navDepth })) as never })
  }, [navigate, path, depth])
  useEffect(() => {
    const whole = arriving
    if (!whole) return
    arriving = null
    if (whole.at === path.at && stepShows(whole.steps[whole.at]) === stepShows(path.steps[path.at]) && encodePath(whole) !== encodePath(path))
      void navigate({ href: pathHref(whole), replace: true, state: ((was: object) => ({ ...was, navDepth: depth })) as never })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  // What the tree unfolded since the current step was taken: it belongs to
  // that step on screen only, until the user moves to another step.
  const [unfolded, setUnfolded] = useState<{ path: NavPath; expanded: string[] } | null>(null)
  const live = unfolded && unfolded.path === path ? unfolded.expanded : null
  return useMemo<AddressNavigation>(() => {
    const stored = path.steps[path.at]
    const step = live ? { ...stored, expanded: live } : stored
    // A step on the same screen carries the tree as it is now.
    const carry = (next: NavStep) => live && sameScreen(next, stored) && !next.expanded ? { ...next, expanded: live } : next
    return {
      path,
      step,
      // A step that takes the current one's place (it shows the same) changes
      // this history entry; anything else is a new one.
      push: (next) => show(pushStep(path, carry(next)), stepShows(stored) === stepShows(next)),
      replace: (next) => show(replaceAt(path, next), true),
      go: (index) => {
        const steps = path.at - index
        if (steps > 0 && steps <= depth) {
          // That entry's address ends at its own step; on arrival it is
          // rewritten with the whole path, so the steps after it stay.
          arriving = goTo(path, index)
          router.history.go(-steps)
        } else show(goTo(path, index))
      },
      open: (next) => show(next, false, -1),
      advanceTo: (next) => {
        void (async () => {
          if (next.at > 0) await navigate({ href: pathHref({ steps: next.steps, at: next.at - 1 }), replace: true, state: ((was: object) => ({ ...was, navDepth: depth })) as never })
          await navigate({ href: pathHref(next), state: ((was: object) => ({ ...was, navDepth: depth + 1 })) as never })
        })()
      },
      href: pathHref,
      addressed: true,
      setExpanded: (expanded) => setUnfolded({ path, expanded }),
    }
  }, [path, show, live, depth, router, navigate])
}

/** A navigation held in memory, for a screen with no address of its own. */
export function useLocalNavigation(here: NavStep): LocalNavigation {
  const [path, setPath] = useState<NavPath>(() => pushStep(EMPTY_PATH, here))
  return useMemo<LocalNavigation>(() => ({
    path,
    step: path.steps[path.at],
    push: (step) => setPath((p) => pushStep(p, step)),
    replace: (step) => setPath((p) => replaceAt(p, step)),
    open: setPath,
    advanceTo: setPath,
    addressed: false,
  }), [path])
}
