import { useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SIDEBAR_ROWS_EVENT, SIDEBAR_ROWS_GLOBAL, isSidebarAddress, mergeSidebarSections, namesDefaultPiece, type SidebarItem, type SidebarRows, type SidebarSection } from 'shared'
import { List } from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { SIDEBAR_ICON } from '../lib/app-icons'
import { SidebarSections, type ShownItem, type ShownSection } from './SidebarSections'

// #1385 (slice 4): an app's own sections in its sidebar: the ones its manifest
// declares (from the catalog, addresses under its root), filled and followed by
// the rows its one runtime call gives (setSidebarRows), drawn by the platform.

type RowsWindow = Window & { [SIDEBAR_ROWS_GLOBAL]?: SidebarRows }

/** The rows the app gave last, followed as it gives new ones. */
export function useAppSidebarRows(): SidebarRows | undefined {
  return useSyncExternalStore(
    (changed) => {
      window.addEventListener(SIDEBAR_ROWS_EVENT, changed)
      return () => window.removeEventListener(SIDEBAR_ROWS_EVENT, changed)
    },
    () => (window as RowsWindow)[SIDEBAR_ROWS_GLOBAL],
  )
}

/** The page's whole address, followed as the app moves it by hash or history. */
function usePageHref(): string {
  const [href, setHref] = useState(window.location.href)
  useEffect(() => {
    const follow = () => setHref(window.location.href)
    window.addEventListener('hashchange', follow)
    window.addEventListener('popstate', follow)
    return () => {
      window.removeEventListener('hashchange', follow)
      window.removeEventListener('popstate', follow)
    }
  }, [])
  return href
}

const resolved = (address: string) => new URL(address, window.location.href).href

/** Only what the platform may draw: a row goes somewhere on this site, under words that are not a default piece's. */
function drawable(section: SidebarSection): SidebarSection {
  const ok = (row: { label: string; address: string }) => isSidebarAddress(row.address) && !namesDefaultPiece(row.label)
  return {
    ...section,
    items: section.items.filter(ok).map((item) => (item.children ? { ...item, children: item.children.filter(ok) } : item)),
  }
}

/** The app's sections as the sidebar draws them, with the open rows marked: those the app names, or else the one
 *  whose address is the page's own. */
export function shownAppSections(declared: readonly SidebarSection[], rows: SidebarRows | undefined, here: string): ShownSection[] {
  const sections = mergeSidebarSections(declared, rows?.sections ?? []).map(drawable)
  const named = rows?.current === undefined ? [] : [rows.current].flat()
  const open = new Set(named.length ? named.map(resolved) : [here])
  const show = (item: SidebarItem): ShownItem => ({
    label: item.label,
    address: item.address,
    icon: SIDEBAR_ICON[item.icon] ?? List,
    ...(item.count !== undefined && { count: item.count }),
    ...(item.initials && { initials: true }),
    ...(item.id && { id: item.id }),
    current: open.has(resolved(item.address)),
    ...(item.children && { children: item.children.map((child) => ({ ...child, current: open.has(resolved(child.address)) })) }),
  })
  return sections.map((section, i) => ({
    id: section.id,
    first: i === 0,
    ...(section.title && { title: section.title }),
    ...(section.icon && { fold: SIDEBAR_ICON[section.icon] ?? List }),
    items: section.items.map(show),
  }))
}

/** What the catalog says of the app behind this page. */
interface CatalogApp { name: string; sidebar?: SidebarSection[] }

export function AppSidebarSections({ app }: { app: string }) {
  const catalog = useQuery({ queryKey: ['app-catalog'], queryFn: () => api.get<CatalogApp[]>('/api/app_catalog') })
  const declared = catalog.data?.find((entry) => entry.name === app)?.sidebar ?? []
  const rows = useAppSidebarRows()
  const here = usePageHref()
  return <SidebarSections sections={shownAppSections(declared, rows, here)} links="page" />
}
