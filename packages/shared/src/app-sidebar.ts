// #1385 (slice 4): an app's own sections in the shared sidebar. The app gives
// data, never markup: its manifest's `sidebar` declares the sections that never
// change, and one runtime call (`setSidebarRows`, @featherbase/shop-floor/sidebar)
// gives the rows that do (Dash's reports per role, Tasker's counts). The
// platform's frame draws both, beside its own defaults, the same way it draws
// the Admin's Modules and Data.

/** The icons a sidebar row may name. Named, so an app never ships its own artwork into the shared sidebar. */
export const SIDEBAR_ICONS = [
  'home', 'report', 'target', 'list', 'checklist', 'calendar', 'inbox', 'person',
  'people', 'person-check', 'check', 'check-circle', 'alert', 'warning', 'store', 'building',
  'folder', 'tag', 'layers', 'grid', 'table', 'chart', 'trend', 'rows', 'filter', 'shield',
  'swap', 'idea', 'refresh', 'settings', 'link', 'wrench', 'box', 'truck', 'clipboard',
] as const
export type SidebarIcon = (typeof SIDEBAR_ICONS)[number]

/** A row's or a section's words fit the sidebar's 240px. */
export const SIDEBAR_LABEL_MAX = 48

/** The platform's own sidebar pieces. An app never draws a copy of one, nor names a row of its own after one
 *  (the web suite's default-pieces guard, and the manifest check). Apps may not hide Recently Opened, Frequent
 *  or Saved Views (Siraj's settled default on #1385): they are fixed everywhere, as are the rest. */
export const SIDEBAR_DEFAULT_PIECES = [
  'App Switcher', 'Search or Command', 'View As', 'Account', 'Help', 'Theme', 'Collapse',
  'Notifications', 'Recently Opened', 'Frequent', 'Saved Views',
] as const

/** Whether a row's words are a default piece's name, which only the platform draws. */
export function namesDefaultPiece(label: string): boolean {
  const words = label.trim().toLowerCase()
  return SIDEBAR_DEFAULT_PIECES.some((piece) => piece.toLowerCase() === words)
}

/** A row nested under another (Tasker's projects under Projects). The rail shows only its parent. */
export interface SidebarChildItem {
  label: string
  /** Where it goes: a path, or a query or hash on the app's page. */
  address: string
  count?: number
}

/** One row: where it goes, its icon and an optional count. */
export interface SidebarItem extends SidebarChildItem {
  icon: SidebarIcon
  /** A name for the row that stays when its words change: tests and the page find it by `data-sidebar-item`. */
  id?: string
  /** In the rail, the row's initials instead of its icon (rows that share one icon, like Dash's reports). */
  initials?: boolean
  children?: SidebarChildItem[]
}

/** A titled group of rows. With an `icon`, the group folds into that one icon in the rail, its menu listing the rows. */
export interface SidebarSection {
  /** How the runtime rows find the section: a runtime section with a declared section's id fills it. */
  id: string
  title?: string
  icon?: SidebarIcon
  items: SidebarItem[]
}

/** The manifest's `sidebar`: its own version, as `tabs` has. */
export interface SidebarDeclaration {
  version: 1
  sections: SidebarSection[]
}

/** What the app's runtime call gives: its sections, and the addresses of the rows open now. Without `current`,
 *  a row whose address is the page's own is the open one. */
export interface SidebarRows {
  current?: string | string[]
  sections: SidebarSection[]
}

/** Where the runtime call leaves the rows for the frame, and the event that says they changed. */
export const SIDEBAR_ROWS_GLOBAL = '__featherbaseSidebarRows'
export const SIDEBAR_ROWS_EVENT = 'featherbase:sidebar-rows'

/** An address a row may go to: a path on this site, or a query or hash on the app's page. Never another
 *  site's, nor a script. */
export function isSidebarAddress(address: string): boolean {
  return /^(?:[?#]|\/(?![/\\]))[^\s]*$/.test(address)
}

/** The declared sections in their order, each filled by the runtime section of the same id (its rows after the
 *  declared ones); the other runtime sections follow. A section with no rows is not drawn. */
export function mergeSidebarSections(declared: readonly SidebarSection[], runtime: readonly SidebarSection[]): SidebarSection[] {
  const fills = new Map(runtime.map((section) => [section.id, section]))
  const merged = declared.map((section) => {
    const fill = fills.get(section.id)
    return fill ? { ...section, title: fill.title ?? section.title, icon: fill.icon ?? section.icon, items: [...section.items, ...fill.items] } : section
  })
  const known = new Set(declared.map((section) => section.id))
  return [...merged, ...runtime.filter((section) => !known.has(section.id))].filter((section) => section.items.length > 0)
}

/** A declared address, resolved under the app's root: `?view=x` and `#x` are the app's root page's, `/…` stays. */
export function sidebarAddressUnder(root: string, address: string): string {
  return address.startsWith('/') ? address : `${root}${address}`
}

/** The declared sections with every address resolved under the app's root, for the catalog. */
export function sidebarSectionsUnder(root: string, sections: readonly SidebarSection[]): SidebarSection[] {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      address: sidebarAddressUnder(root, item.address),
      ...(item.children && { children: item.children.map((child) => ({ ...child, address: sidebarAddressUnder(root, child.address) })) }),
    })),
  }))
}
