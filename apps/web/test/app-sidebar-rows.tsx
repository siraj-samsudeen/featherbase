// #1385 (slice 4): an app's page tests, with the rows it gives the shared sidebar drawn beside it as links in
// the page, so a test opens a row as a person does: by its words. The rows are merged and marked open by the
// platform's own shownAppSections; how the frame draws them (rail, folds, badges) is app-sidebar-rail.test.tsx's.
import { useEffect } from 'react'
import { SIDEBAR_ROWS_GLOBAL, sidebarSectionsUnder, type SidebarSection } from 'shared'
import { shownAppSections, useAppSidebarRows } from '../src/components/AppSidebarSections'

/** `declared`: the app's manifest sections, resolved under this page as the catalog resolves them under the app's root. */
export function AppSidebarRows({ label = 'App sidebar', declared = [] }: { label?: string; declared?: SidebarSection[] }) {
  const rows = useAppSidebarRows()
  // The rows are the page's: unmounted, they go with it, so the next test's page starts with none.
  useEffect(() => () => { delete (window as unknown as Record<string, unknown>)[SIDEBAR_ROWS_GLOBAL] }, [])
  const shown = shownAppSections(sidebarSectionsUnder(window.location.pathname, declared), rows, window.location.href)
  const all = shown.flatMap((section) => section.items.flatMap((item) => [item, ...(item.children ?? [])]))
  return (
    <nav aria-label={label}>
      {all.map((row) => (
        <a key={row.address + row.label} href={row.address} aria-current={row.current ? 'page' : undefined}>
          {row.label}
          {row.count !== undefined && <span data-sidebar-count>{row.count}</span>}
        </a>
      ))}
    </nav>
  )
}

/** A row by its words, whatever count follows them. */
export const rowNamed = (words: string) => new RegExp(`^${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\d+)?$`)
