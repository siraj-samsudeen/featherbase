import { useEffect, useSyncExternalStore } from 'react'
import {
  EMPTY_LEARNING,
  SHORTCUT_SETTINGS,
  noteShortcutUse as rule,
  quietTips as quietRule,
  readLearning,
  turnTipsOn as turnOnRule,
  type ShortcutLearning,
  type TipDue,
} from 'shared'
import { fmtDay } from '@featherbase/shop-floor'
import { api, getSessionUser, getToken } from './api'

// #1251: the one list of keyboard shortcuts every page adds to, and the
// teaching drawn from it: the key in a control's hover text, the Keyboard
// Shortcuts panel with its key badges, and the tips and reminders.
//
// A shortcut keeps its own key handling where it lives (the sidebar's ⌘B, the
// command search's ⌘K); it reports each use here, by key or by mouse. What a
// person has learnt is kept in their own settings record (SHORTCUT_SETTINGS)
// and saved in batches. The rules themselves are shared/shortcut-teaching.

export interface Shortcut {
  id: string
  /** The keys as this person's keyboard names them: "⌘B", "?". */
  keys: string
  /** What it does, in Title Case: "Collapse Or Expand The Sidebar". */
  label: string
  /** The tip's sentence: "Press ⌘B to collapse or expand the sidebar." */
  tip: string
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = (key: string) => (IS_MAC ? `⌘${key}` : `Ctrl+${key}`)

/** The platform's own shortcuts, the first on the list. */
export const SIDEBAR_SHORTCUT_DEF: Shortcut = {
  id: 'sidebar',
  keys: mod('B'),
  label: 'Collapse Or Expand The Sidebar',
  tip: `Press ${mod('B')} to collapse or expand the sidebar.`,
}
export const COMMAND_SHORTCUT_DEF: Shortcut = {
  id: 'command',
  keys: mod('K'),
  label: 'Search Or Type A Command',
  tip: `Press ${mod('K')} to search or type a command from anywhere.`,
}

/** The Admin's leader keys, listed so the panel shows them (they were in
 *  #1253's Help list); their mouse equivalents are many, so they get no tips. */
export const ADMIN_HOME_SHORTCUT_DEF: Shortcut = {
  id: 'admin-home',
  keys: 'G then D',
  label: 'Go To The Admin Home',
  tip: 'Press G then D to go to the Admin home.',
}
export const NEW_ROW_SHORTCUT_DEF: Shortcut = {
  id: 'new-row',
  keys: 'G then N',
  label: 'New Row Of This Table',
  tip: 'Press G then N to start a new row of this Table.',
}

/** How long a tip stays unless dismissed. */
export const TIP_MS = 10_000
/** Uses are sent together, at most this often. */
const SAVE_DELAY_MS = 2000

export interface ShownTip extends TipDue {
  shortcut: Shortcut
  /** Where the control just used sits, so the tip never covers it. */
  near: DOMRect | null
}

interface State {
  shortcuts: Shortcut[]
  learning: ShortcutLearning
  tip: ShownTip | null
  panelOpen: boolean
  /** A short confirmation at the top: "Tips are quiet until …". */
  notice: string | null
}

let state: State = { shortcuts: [], learning: EMPTY_LEARNING, tip: null, panelOpen: false, notice: null }
const listeners = new Set<() => void>()
function set(next: Partial<State>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = () => state

export function useShortcutState(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

// ---- the list --------------------------------------------------------------

const added = new Map<string, { shortcut: Shortcut; count: number }>()
function publish() {
  set({ shortcuts: [...added.values()].map((entry) => entry.shortcut) })
}

/** Puts a shortcut on the list while its page is open; returns its removal. */
export function addShortcut(shortcut: Shortcut): () => void {
  const entry = added.get(shortcut.id)
  if (entry) entry.count += 1
  else added.set(shortcut.id, { shortcut, count: 1 })
  publish()
  let removed = false
  return () => {
    if (removed) return
    removed = true
    // Only this owner's removal runs (the flag above), so its entry is there.
    const current = added.get(shortcut.id)!
    if (current.count <= 1) added.delete(shortcut.id)
    else current.count -= 1
    publish()
  }
}

/** The shortcut is on the list while the calling component is mounted and
 *  `active` (a key that only works on some pages: G then N needs a Table). */
export function useShortcut(shortcut: Shortcut, active = true): void {
  useEffect(() => (active ? addShortcut(shortcut) : undefined), [shortcut, active])
}

/** The attributes that give a control its key: hover text, badge, and the
 *  control a tip must not cover. */
export function shortcutControl(shortcut: Shortcut, title: string) {
  return {
    title: `${title} · ${shortcut.keys}`,
    'data-shortcut-id': shortcut.id,
    'data-shortcut-key': shortcut.keys,
  }
}

// ---- noting use ------------------------------------------------------------

const NOT_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])
/** Whether text is being edited there: no tip interrupts typing. */
export function isTyping(target: EventTarget | null = typeof document === 'undefined' ? null : document.activeElement): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return !NOT_TEXT_INPUTS.has(target.type)
  return target.closest('[contenteditable]') !== null
}

let tipTimer: ReturnType<typeof setTimeout> | undefined
function showTip(tip: ShownTip | null) {
  clearTimeout(tipTimer)
  set({ tip })
  if (tip) tipTimer = setTimeout(() => state.tip === tip && set({ tip: null }), TIP_MS)
}

/** Notes one use of a shortcut's job, by its key or by the mouse. `control` is
 *  what the mouse used, so a tip lands clear of it. */
export function noteShortcutUse(id: string, via: 'key' | 'mouse', control?: Element | null): void {
  if (!signedIn()) return
  const now = Date.now()
  // A tip never interrupts typing or the open panel; the use still counts.
  const held = state.panelOpen || isTyping()
  const near = control?.getBoundingClientRect() ?? null
  const use: PendingUse = {
    id,
    via,
    run: (learning) => {
      const result = rule(held ? { ...learning, lastTip: now } : learning, id, via, now)
      const shortcut = added.get(id)?.shortcut
      return {
        learning: held ? { ...result.learning, lastTip: learning.lastTip } : result.learning,
        tip: !held && result.tip && shortcut ? { ...result.tip, shortcut, near } : null,
      }
    },
  }
  // Before the person's learning has arrived, uses wait and are replayed on it.
  if (!loaded) {
    pending.push(use)
    return
  }
  const result = use.run(state.learning)
  set({ learning: result.learning })
  scheduleSave()
  if (via === 'key' && state.tip?.id === id) showTip(null)
  if (result.tip) showTip(result.tip)
}

interface PendingUse {
  id: string
  via: 'key' | 'mouse' | 'change'
  run: (learning: ShortcutLearning) => { learning: ShortcutLearning; tip: ShownTip | null }
}

export function dismissTip(): void {
  showTip(null)
}

export function setShortcutsPanelOpen(open: boolean): void {
  if (open) showTip(null)
  set({ panelOpen: open })
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined
function showNotice(notice: string) {
  clearTimeout(noticeTimer)
  set({ notice })
  noticeTimer = setTimeout(() => set({ notice: null }), 5000)
}

export const quietUntilText = (learning: ShortcutLearning) => fmtDay(new Date(learning.quietUntil))

/** A change the person makes to their learning (quiet, turn on, reset). Made
 *  before their learning has arrived, it waits and is replayed on it, so the
 *  answer can never undo it. */
function change(next: (learning: ShortcutLearning) => ShortcutLearning): ShortcutLearning {
  if (!loaded) {
    pending.push({ id: '', via: 'change', run: (learning) => ({ learning: next(learning), tip: null }) })
    return next(state.learning)
  }
  const learning = next(state.learning)
  set({ learning })
  scheduleSave()
  return learning
}

export function quietTips(): void {
  showTip(null)
  const learning = change((l) => quietRule(l, Date.now()))
  showNotice(`Tips are quiet until ${quietUntilText(learning)}. They come back after that.`)
}

export function turnTipsOn(): void {
  change(turnOnRule)
}

export function resetTips(): void {
  showTip(null)
  change(() => EMPTY_LEARNING)
}

// ---- keeping it ------------------------------------------------------------

const signedIn = () => Boolean(getToken() && getSessionUser())
let loaded = false
let pending: PendingUse[] = []
let mounted = 0
/** Which mounting a read belongs to: a read that answers after its teaching
 *  unmounted (the Admin's loading screen giving way to the page) is dropped. */
let generation = 0
let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
// One chain, so a slower earlier save never lands after a newer one, and a
// read waits for the saves before it.
let chain: Promise<unknown> = Promise.resolve()

function scheduleSave() {
  dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flushShortcutLearning(), SAVE_DELAY_MS)
}

/** Sends what was learnt now. A save merges top-level keys, so it sends them all. */
export function flushShortcutLearning(): Promise<unknown> {
  clearTimeout(saveTimer)
  if (!dirty) return chain
  dirty = false
  const body = state.learning
  const token = getToken()
  chain = chain
    .then(() => (token && getToken() === token ? api.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, body) : undefined))
    .catch(() => {})
  return chain
}

function load() {
  const token = getToken()
  if (!token || !getSessionUser()) return
  const mine = generation
  chain = chain
    .then(() => api.get<{ settings: unknown }>(`/api/user_settings/${SHORTCUT_SETTINGS}`))
    .then((stored) => {
      if (getToken() !== token || mine !== generation) return
      let learning = readLearning(stored.settings)
      let tip: ShownTip | null = null
      for (const use of pending) {
        const result = use.run(learning)
        learning = result.learning
        if (use.via === 'key' && tip?.id === use.id) tip = null
        if (result.tip) tip = result.tip
      }
      const changed = pending.length > 0
      pending = []
      loaded = true
      set({ learning })
      if (changed) scheduleSave()
      if (tip) showTip(tip)
    })
    .catch(() => {
      if (mine !== generation) return
      // Unread: teaching starts from nothing for this visit, and never
      // overwrites what the server holds.
      pending = []
      loaded = true
    })
}

/** Reads what is stored, applies the waiting uses and changes, and saves: on
 *  the one chain, so it lands after any save before it. */
function saveWaiting(waiting: PendingUse[]) {
  const token = getToken()
  if (!token) return
  chain = chain
    .then(() => api.get<{ settings: unknown }>(`/api/user_settings/${SHORTCUT_SETTINGS}`))
    .then((stored) => {
      if (getToken() !== token) return
      const learning = waiting.reduce((l, use) => use.run(l).learning, readLearning(stored.settings))
      return api.put(`/api/user_settings/${SHORTCUT_SETTINGS}`, learning)
    })
    .catch(() => {})
}

function onLeave() {
  void flushShortcutLearning()
}

/** The teaching is live while one is mounted (the top bar's): the first loads
 *  the person's learning, the last to leave sends what changed. */
export function useShortcutTeaching(): void {
  useEffect(() => {
    mounted += 1
    if (mounted === 1) {
      generation += 1
      loaded = false
      pending = []
      load()
      window.addEventListener('pagehide', onLeave)
    }
    return () => {
      mounted -= 1
      if (mounted === 0) {
        window.removeEventListener('pagehide', onLeave)
        void flushShortcutLearning()
        // Uses made before the learning arrived are not lost when the page
        // closes first: they are applied to what is stored, then saved.
        if (!loaded && pending.length > 0) saveWaiting(pending)
        showTip(null)
        set({ panelOpen: false, notice: null, learning: EMPTY_LEARNING })
        loaded = false
        generation += 1
      }
    }
  }, [])
}
