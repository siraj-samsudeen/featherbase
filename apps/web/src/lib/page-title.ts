import { useEffect, useSyncExternalStore } from 'react'

// #1224's verifier, #1227: the browser tab reads "<page> · <app>" ("Department ·
// Featherbase", "Sign-in methods · Dash"). A page says its own title here; the
// shared top bar writes the tab, with the app's name after it, or the app's
// name alone on a page that says none.

let current: string | undefined
const listeners = new Set<() => void>()
const emit = () => { for (const listener of listeners) listener() }

/** The page's title for the browser tab while the calling component is shown. */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    if (!title) return
    current = title
    emit()
    return () => {
      if (current === title) {
        current = undefined
        emit()
      }
    }
  }, [title])
}

/** The title the shown page gave, if any. */
export function useCurrentPageTitle(): string | undefined {
  // The same snapshot serves the browser and a server render.
  const snapshot = () => current
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, snapshot, snapshot)
}
