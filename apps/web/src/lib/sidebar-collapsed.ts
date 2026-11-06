import { useCallback, useState } from 'react'

// #1018: whether this person keeps the Admin sidebar collapsed. A convenience
// kept per person in this browser, like the recents: a shared browser never
// shows one person's choice to another, and blocked storage only costs the memory.
const storageKey = (user: string) => `fc-sidebar-collapsed:${user}`

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

export function useSidebarCollapsed(user: string | undefined) {
  const [collapsed, setCollapsed] = useState(() => load(user))
  const toggle = useCallback(() => {
    setCollapsed(!collapsed)
    save(user, !collapsed)
  }, [collapsed, user])
  return [collapsed, toggle] as const
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
