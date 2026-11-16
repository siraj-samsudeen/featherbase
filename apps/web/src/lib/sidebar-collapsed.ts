import { useCallback, useEffect, useSyncExternalStore } from 'react'

// #1227: one sidebar state for every page that has a sidebar — the Admin's own
// and the shared app sidebar (<featherbase-sidebar>) under any installed app.
// The top bar draws the controls, Ctrl/Cmd+B works the same everywhere, and
// the choice is one per person in this browser, whichever app made it.
//
// #1018: whether this person keeps the sidebar collapsed is a convenience kept
// per person in this browser, like the recents: a shared browser never shows
// one person's choice to another, and blocked storage only costs the memory.
const storageKey = (user: string) => `fc-sidebar-collapsed:${user}`

/** Below this the sidebar is a drawer over the page, never collapsed (UI-025). */
export const SIDEBAR_DRAWER_QUERY = '(width < 48rem)'

function load(user: string | undefined): boolean {
  if (!user) return false
  try {
    return localStorage.getItem(storageKey(user)) === '1'
  } catch {
    return false
  }
}

function save(user: string | undefined, collapsed: boolean): void {
  if (!user) return
  try {
    if (collapsed) localStorage.setItem(storageKey(user), '1')
    else localStorage.removeItem(storageKey(user))
  } catch {
    // Blocked or full: the choice lasts for this visit.
  }
}

export interface SidebarState {
  /** The person's choice; a drawer-width window ignores it. */
  collapsed: boolean
  /** The phone drawer is open. */
  drawerOpen: boolean
  /** How many sidebars the document holds now: the bar offers controls only for one. */
  present: number
}

let owner: string | undefined
let state: SidebarState = { collapsed: false, drawerOpen: false, present: 0 }
const listeners = new Set<() => void>()

function set(next: Partial<SidebarState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

/** The state for this person: a different person (or a first sidebar on the
 *  page, as after a reload) reads their own choice back from the browser. */
function stateFor(user: string | undefined): SidebarState {
  if (user !== owner) {
    owner = user
    state = { ...state, collapsed: load(user) }
  }
  return state
}

export function subscribeSidebar(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function readSidebar(user: string | undefined): SidebarState {
  return stateFor(user)
}

export function toggleSidebarCollapsed(user: string | undefined): void {
  const collapsed = !stateFor(user).collapsed
  save(user, collapsed)
  set({ collapsed })
}

export function setSidebarDrawerOpen(open: boolean): void {
  if (state.drawerOpen !== open) set({ drawerOpen: open })
}

/** A sidebar joins the page; the returned function is its leaving. */
export function registerSidebar(user: string | undefined): () => void {
  // The first sidebar on a page starts from the kept choice, as a reload does.
  if (state.present === 0) {
    owner = user
    set({ present: 1, collapsed: load(user), drawerOpen: false })
  } else set({ present: state.present + 1 })
  let left = false
  return () => {
    if (left) return
    left = true
    set({ present: Math.max(0, state.present - 1), ...(state.present <= 1 ? { drawerOpen: false } : {}) })
  }
}

/** The sidebar state, for React. */
export function useSidebar(user: string | undefined) {
  const current = useSyncExternalStore(subscribeSidebar, () => stateFor(user), () => stateFor(user))
  const toggle = useCallback(() => toggleSidebarCollapsed(user), [user])
  return { ...current, toggleCollapsed: toggle, setDrawerOpen: setSidebarDrawerOpen }
}

/** The page has a sidebar for as long as the calling component is mounted. */
export function useRegisterSidebar(user: string | undefined): void {
  useEffect(() => registerSidebar(user), [user])
}

/** The shortcut as this person's keyboard names it, for the control's hover text. */
export const SIDEBAR_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘B' : 'Ctrl+B'

const NOT_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

/** Whether a key press lands where text is being edited, so Ctrl/Cmd+B means
 *  bold or the browser's own there. A checkbox or a select holds no text. */
export function isEditingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return !NOT_TEXT_INPUTS.has(target.type)
  return target.closest('[contenteditable]') !== null
}

const isDrawerWidth = () => typeof window.matchMedia === 'function' && window.matchMedia(SIDEBAR_DRAWER_QUERY).matches

/** Ctrl/Cmd+B collapses and reopens the sidebar, and Escape closes the drawer,
 *  on any page that has a sidebar. Returns the listener's removal. */
export function listenForSidebarKeys(user: () => string | undefined, target: Document = document): () => void {
  function onKey(e: KeyboardEvent) {
    if (state.present === 0) return
    if (e.key === 'Escape' && state.drawerOpen) {
      setSidebarDrawerOpen(false)
      return
    }
    // With Shift it is the browser's bookmarks bar; in a field it is bold or
    // the browser's own; a phone has its drawer instead. Inside a shadow root
    // (the bar) the event's target is the host: the path names the field.
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'b') return
    if (isEditingText(e.composedPath()[0] ?? e.target) || isDrawerWidth()) return
    e.preventDefault()
    if (!e.repeat) toggleSidebarCollapsed(user())
  }
  target.addEventListener('keydown', onKey)
  return () => target.removeEventListener('keydown', onKey)
}
