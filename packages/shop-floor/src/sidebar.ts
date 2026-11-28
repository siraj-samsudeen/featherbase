import { useEffect } from 'react'
import { SIDEBAR_ROWS_EVENT, SIDEBAR_ROWS_GLOBAL, type SidebarRows } from 'shared'

// #1385 (slice 4): the one runtime call an app makes for the rows of the shared
// sidebar that change while it runs: its counts, the rows a person's roles give
// them, and which row is open. It gives data, never markup; the platform's frame
// (the bar bundle) draws them beside the sections the app's manifest declares.
export type { SidebarChildItem, SidebarIcon, SidebarItem, SidebarRows, SidebarSection } from 'shared'
/** How the frame puts the manifest's sections and the runtime ones together: for an app's own tests. */
export { mergeSidebarSections } from 'shared'

type RowsWindow = Window & { [SIDEBAR_ROWS_GLOBAL]?: SidebarRows }

/** Give the shared sidebar the app's rows now. Each call replaces the last. */
export function setSidebarRows(rows: SidebarRows): void {
  ;(window as RowsWindow)[SIDEBAR_ROWS_GLOBAL] = rows
  window.dispatchEvent(new window.CustomEvent(SIDEBAR_ROWS_EVENT, { detail: rows }))
}

/** The rows the app gave last, if any: what the frame draws, and what an app's own tests read. */
export function readSidebarRows(): SidebarRows | undefined {
  return (window as RowsWindow)[SIDEBAR_ROWS_GLOBAL]
}

/** setSidebarRows from a component: given again whenever the rows change. */
export function useSidebarRows(rows: SidebarRows): void {
  const key = JSON.stringify(rows)
  useEffect(() => setSidebarRows(JSON.parse(key) as SidebarRows), [key])
}
