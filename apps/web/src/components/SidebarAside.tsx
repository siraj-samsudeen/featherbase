import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { ChevronsLeft, ChevronsRight, touchRowClasses, useMediaQuery } from '@featherbase/shop-floor'
import { RAIL_ROW, ROW_IDLE, SidebarRailContext } from './SidebarRail'
import { attachRailTips } from '../lib/sidebar-rail'
import { SIDEBAR_DRAWER_QUERY, SIDEBAR_SHORTCUT, offerSidebarSlots, useRegisterSidebar, useSidebar } from '../lib/sidebar-collapsed'

/**
 * #1227: the one sidebar frame, for the Admin and the account pages alike: 240px
 * beside the page, a 256px drawer with a backdrop under 48rem, hidden when
 * collapsed; the bar's controls and Cmd/Ctrl+B work it (lib/sidebar-collapsed).
 * Following any link inside it closes the drawer.
 *
 * #1253 (Quiet Canvas): no fill and no border of its own, on the grey canvas.
 * Its top and foot are slots the shared bar draws into (the switcher, the bell
 * and the command field; the account, help and theme), and only the links
 * between them scroll, so the menus that open from the top and foot are never
 * clipped.
 */
export function SidebarAside({ testid, user, children }: { testid: string; user: string | undefined; children: ReactNode }) {
  useRegisterSidebar(user)
  const { collapsed: choice, drawerOpen, setDrawerOpen, toggleCollapsed } = useSidebar(user)
  const isDrawer = useMediaQuery(SIDEBAR_DRAWER_QUERY)
  const collapsed = choice && !isDrawer
  // #1248: in the rail each row is named at once by a tooltip beside it.
  const aside = useRef<HTMLElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const foot = useRef<HTMLDivElement>(null)
  const railRef = useRef(collapsed)
  railRef.current = collapsed
  useEffect(() => {
    // The aside is always drawn by the time this runs.
    const root = aside.current!
    return attachRailTips({
      root, layer: document.body,
      active: () => railRef.current,
      // A row of an open menu (the switcher's, the account's) needs no tooltip.
      rowOf: (target) => (target instanceof Element && !target.closest('[role="menu"]') ? target.closest<HTMLElement>('a, button') : null) ?? null,
    })
  }, [])
  // Offered before the first paint, so the page never shows a top bar first.
  useLayoutEffect(() => offerSidebarSlots({ top: top.current!, foot: foot.current! }), [])
  const words = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  return (
    <SidebarRailContext.Provider value={collapsed}>
      {/* UI-025: on mobile, a backdrop closes the drawer. */}
      {drawerOpen && (
        <div
          className="absolute inset-0 z-20 bg-scrim/30 md:hidden"
          data-testid="sidebar-backdrop"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <aside
        ref={aside}
        data-testid={testid}
        data-collapsed={collapsed ? true : undefined}
        inert={isDrawer && !drawerOpen ? true : undefined}
        aria-hidden={isDrawer && !drawerOpen ? true : undefined}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setDrawerOpen(false)
        }}
        className={`${collapsed ? 'md:w-14' : 'md:w-60'} absolute inset-y-0 left-0 z-30 flex w-64 flex-col bg-canvas transition-transform md:static md:shrink-0 md:translate-x-0 md:bg-transparent md:transition-[width] md:duration-200 md:ease-linear motion-reduce:transition-none ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div ref={top} className="shrink-0" data-testid="sidebar-slot-top" />
        <div className={`min-h-0 flex-1 overflow-y-auto${collapsed ? ' md:overflow-x-hidden' : ''}`} data-testid="sidebar-links">
          {children}
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
      </aside>
      <div
        aria-hidden
        data-testid="sidebar-edge"
        onClick={toggleCollapsed}
        className="group relative z-30 -mx-1.5 w-3 shrink-0 cursor-col-resize max-md:hidden"
      >
        <span className="absolute inset-y-0 left-[5px] w-0.5 bg-transparent transition-colors group-hover:bg-action" />
      </div>
    </SidebarRailContext.Provider>
  )
}

