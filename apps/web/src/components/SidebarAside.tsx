import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { ChevronsLeft, ChevronsRight, touchRowClasses, useMediaQuery } from '@featherbase/shop-floor'
import { APP_ACCENT_ATTRIBUTE } from '@featherbase/shop-floor/theme'
import { RAIL_ROW, ROW_IDLE, SidebarRailContext } from './SidebarRail'
import { attachRailTips } from '../lib/sidebar-rail'
import { SIDEBAR_DRAWER_QUERY, SIDEBAR_SHORTCUT, offerSidebarSlots, useRegisterSidebar, useSidebar } from '../lib/sidebar-collapsed'

/** #1385 (slice 3): the frame drawn for an app, inside `<featherbase-sidebar>`'s
 *  shadow root (bar/sidebar.tsx). The element is the frame's box on the app's
 *  page: it carries the frame's state (`data-collapsed`, `data-open`, inert while
 *  a shut drawer) for the app's rail rules, and the frame follows the bar's
 *  painted theme and the app's accent, which the app's document cannot reach. */
export interface AppFrame {
  host: HTMLElement
  theme?: string
  accent?: string | null
}

/**
 * #1227: the one sidebar frame, for the Admin, the account pages and (#1385,
 * slice 3) every app alike: 240px beside the page, a 256px drawer with a
 * backdrop under 48rem; the bar's controls and Cmd/Ctrl+B work it
 * (lib/sidebar-collapsed). Following any link inside it closes the drawer.
 *
 * #1253 (Quiet Canvas): no fill and no border of its own, on the grey canvas.
 * Its top and foot are slots the shared bar draws into (the switcher, the bell
 * and the command field; the account, help and theme), and only the links
 * between them scroll, so the menus that open from the top and foot are never
 * clipped.
 *
 * In an app (`app`) the links are the app's declared sections (#1385, slice 4),
 * then the platform's defaults (slice 2), both drawn into slots by the shared
 * bar; the element's stylesheet places the frame on the app's page
 * (bar/sidebar.tsx).
 */

/** The row a tooltip names: a link or button of the sidebar, not one in an open menu (the switcher's, the account's). */
const rowOfTarget = (target: EventTarget | null) =>
  (target instanceof Element && !target.closest('[role="menu"]') ? target.closest<HTMLElement>('a, button') : null) ?? null

export function SidebarAside({ testid, user, app, children }: { testid: string; user: string | undefined; app?: AppFrame; children?: ReactNode }) {
  useRegisterSidebar(user)
  const { collapsed: choice, drawerOpen, setDrawerOpen, toggleCollapsed } = useSidebar(user)
  const isDrawer = useMediaQuery(SIDEBAR_DRAWER_QUERY)
  const collapsed = choice && !isDrawer
  const shut = isDrawer && !drawerOpen
  // #1248: in the rail each row is named at once by a tooltip beside it.
  const aside = useRef<HTMLElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const foot = useRef<HTMLDivElement>(null)
  const defaults = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const railRef = useRef(collapsed)
  railRef.current = collapsed
  const sections = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!app) return
    // An app's rows are the platform's own, drawn in the element's shadow root: their tooltips are worked on the
    // element (events from the shadow reach it) and drawn in its shadow root.
    return attachRailTips({ root: app.host, layer: layer.current!, active: () => railRef.current, rowOf: rowOfTarget })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- an element keeps its frame for life
  useEffect(() => {
    if (app) return
    // The aside is always drawn by the time this runs.
    return attachRailTips({ root: aside.current!, layer: document.body, active: () => railRef.current, rowOf: rowOfTarget })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- as above
  useLayoutEffect(() => {
    if (!app) return
    // The element is the frame's box: the app's rail rules read its state.
    app.host.toggleAttribute('data-collapsed', collapsed)
    app.host.toggleAttribute('data-open', isDrawer && drawerOpen)
    app.host.inert = shut
    if (shut) app.host.setAttribute('aria-hidden', 'true')
    else app.host.removeAttribute('aria-hidden')
  })
  // Offered before the first paint, so the page never shows a top bar first.
  useLayoutEffect(() => offerSidebarSlots({ top: top.current!, foot: foot.current!, ...(app ? { sections: sections.current!, defaults: defaults.current! } : {}) }), []) // eslint-disable-line react-hooks/exhaustive-deps -- as above
  const words = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  const Frame = app ? 'div' : 'aside'
  const edge = (
    <div
      aria-hidden
      data-testid="sidebar-edge"
      onClick={toggleCollapsed}
      className={app ? 'sidebar-edge' : 'group relative z-30 -mx-1.5 w-3 shrink-0 cursor-col-resize max-md:hidden'}
    >
      {!app && <span className="absolute inset-y-0 left-[5px] w-0.5 bg-transparent transition-colors group-hover:bg-action" />}
    </div>
  )
  return (
    <SidebarRailContext.Provider value={collapsed}>
      {/* UI-025: on mobile, a backdrop closes the drawer. */}
      {drawerOpen && (
        <div
          className={app ? 'sidebar-backdrop' : 'absolute inset-0 z-20 bg-scrim/30 md:hidden'}
          data-testid="sidebar-backdrop"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <Frame
        ref={aside as never}
        data-testid={testid}
        // In an app the element carries the state; the frame carries the theme and the accent.
        data-collapsed={collapsed && !app ? true : undefined}
        inert={shut && !app ? true : undefined}
        aria-hidden={shut && !app ? true : undefined}
        data-theme={app?.theme}
        {...(app?.accent ? { [APP_ACCENT_ATTRIBUTE]: app.accent } : {})}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setDrawerOpen(false)
        }}
        className={app ? 'sidebar-frame' : `${collapsed ? 'md:w-14' : 'md:w-60'} absolute inset-y-0 left-0 z-30 flex w-64 flex-col bg-canvas transition-transform md:static md:shrink-0 md:translate-x-0 md:bg-transparent md:transition-[width] md:duration-200 md:ease-linear motion-reduce:transition-none ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div ref={top} className="shrink-0" data-testid="sidebar-slot-top" />
        <div className={`min-h-0 flex-1 overflow-y-auto${collapsed ? ' md:overflow-x-hidden' : ''}${app ? ' flex flex-col px-2 py-1' : ''}`} data-testid="sidebar-links">
          {children}
          {/* #1385 (slice 4): in an app, the app's declared sections, drawn by the shared bar (TopBar); then
              (slice 2) the platform's defaults. */}
          {app && <div ref={sections} className="-mx-2 shrink-0" data-testid="sidebar-slot-sections" />}
          {app && <div ref={defaults} className="sidebar-defaults -mx-2 shrink-0" data-testid="sidebar-slot-defaults" />}
        </div>
        <div className="shrink-0 p-2">
          <div ref={foot} data-testid="sidebar-slot-foot" />
          {/* #1248: the control is the sidebar's own: its footer row, and its edge. */}
          <button
            type="button"
            onClick={toggleCollapsed}
            data-testid="sidebar-collapse"
            // #1251's keyboard-shortcut list finds the control by these.
            data-shortcut-id="sidebar"
            data-shortcut-key={SIDEBAR_SHORTCUT}
            aria-label={words}
            aria-keyshortcuts="Meta+B Control+B"
            title={`${words.replace('sidebar', 'Sidebar')} · ${SIDEBAR_SHORTCUT}`}
            className={`max-md:hidden ${collapsed ? `${RAIL_ROW} ${ROW_IDLE}` : touchRowClasses(`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm ${ROW_IDLE}`)}`}
          >
            {collapsed ? <ChevronsRight aria-hidden size={18} className="text-ink-muted" /> : <ChevronsLeft aria-hidden size={16} className="shrink-0 text-ink-muted" />}
            {!collapsed && <span className="flex-1 text-left text-ink-muted">Collapse</span>}
            {!collapsed && <kbd className="font-mono text-xs text-ink-subtle">{SIDEBAR_SHORTCUT}</kbd>}
          </button>
        </div>
        {app && edge}
        {app && <div ref={layer} className="rail-layer" />}
      </Frame>
      {!app && edge}
    </SidebarRailContext.Provider>
  )
}
