import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { rowHref, tableHref } from 'shared'
import { EMPTY_PATH, decodePath, encodePath, go as goTo, push as pushStep, replace as replaceAt, stepShows, type NavPath, type NavStep } from './nav-path'

// #910 D1: where the user is on their walk between related rows. The list
// and row pages keep the path in their address (`?path=`), so every drill and
// filter is a browser history entry and a shareable link; other screens
// (Explore) keep one in memory. Screens read and move it through this
// context; a screen outside any provider simply has no path.

export interface Navigation {
  path: NavPath
  /** The step on screen. */
  step: NavStep
  /** A new step after the current one: every drill and every filter. */
  push: (step: NavStep) => void
  /** Changes the step on screen without adding one: the open group, the tab, the tree's expansion. */
  replace: (step: NavStep) => void
  /** Moves to step `index` of the path. */
  go: (index: number) => void
  /** Puts a whole path on screen (a recent path). */
  open: (path: NavPath) => void
  /** Puts a whole path on screen in place of the current one, adding no history entry. */
  reshape: (path: NavPath) => void
  /** Rewrites the path and moves one step on along it: the step before the
   *  new current one takes this history entry and the new one adds an entry,
   *  so the browser's back button lands on the step before it on the path. */
  advanceTo: (path: NavPath) => void
  /** The address of a path on the page that shows its current step, for links. */
  href: (path: NavPath) => string
  /** Whether this navigation lives in the address (and so can be shared). */
  addressed: boolean
  /** Unfolds or folds the tree on screen. The step keeps what was unfolded
   *  when it was taken; later changes stay on the page and go into the next
   *  step taken from it, so an earlier step brings back its own tree. */
  setExpanded: (expanded: string[]) => void
}

const NavigationContext = createContext<Navigation | null>(null)

export const useNavigation = () => useContext(NavigationContext)

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
export function useAddressNavigation(here: NavStep, raw: unknown): Navigation {
  const navigate = useNavigate()
  const decoded = useMemo(() => decodePath(raw), [raw])
  const hereKey = JSON.stringify(here)
  const path = useMemo<NavPath>(() => {
    if (decoded && sameScreen(decoded.steps[decoded.at], here)) return decoded
    return pushStep(EMPTY_PATH, here)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, hereKey])
  const show = useCallback((next: NavPath, replace = false) => {
    if (next === path) return
    void navigate({ href: pathHref(next), replace })
  }, [navigate, path])
  // What the tree unfolded since the current step was taken: it belongs to
  // that step on screen only, until the user moves to another step.
  const [unfolded, setUnfolded] = useState<{ path: NavPath; expanded: string[] } | null>(null)
  const live = unfolded && unfolded.path === path ? unfolded.expanded : null
  return useMemo<Navigation>(() => {
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
      go: (index) => show(goTo(path, index)),
      open: (next) => show(next),
      reshape: (next) => show(next, true),
      advanceTo: (next) => {
        void (async () => {
          if (next.at > 0) await navigate({ href: pathHref({ steps: next.steps, at: next.at - 1 }), replace: true })
          await navigate({ href: pathHref(next) })
        })()
      },
      href: pathHref,
      addressed: true,
      setExpanded: (expanded) => setUnfolded({ path, expanded }),
    }
  }, [path, show, live])
}

/** A navigation held in memory, for a screen with no address of its own. */
export function useLocalNavigation(here: NavStep): Navigation {
  const [path, setPath] = useState<NavPath>(() => pushStep(EMPTY_PATH, here))
  return useMemo<Navigation>(() => ({
    path,
    step: path.steps[path.at],
    push: (step) => setPath((p) => pushStep(p, step)),
    replace: (step) => setPath((p) => replaceAt(p, step)),
    go: (index) => setPath((p) => goTo(p, index)),
    open: setPath,
    reshape: setPath,
    advanceTo: setPath,
    href: () => '',
    addressed: false,
    setExpanded: (expanded) => setPath((p) => replaceAt(p, { ...p.steps[p.at], expanded })),
  }), [path])
}
