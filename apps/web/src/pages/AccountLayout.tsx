import { Outlet } from '@tanstack/react-router'
import { PagePickerSlot, TopBar, useOnAppAddress } from '../components/TopBar'
import { useShellKind } from '../lib/session'
import { AccountSidebarGroup, AdminShell, PAGE_PANEL, SidebarAside } from './AdminLayout'
import { getSessionUser } from '../lib/api'
import { ThemeChoiceProvider } from '../lib/theme-choice'

// #489 item 13: the person's own account pages, outside the Admin screens.
// Every address serves them (an app's address keeps people out of Admin), so
// someone without Admin wears the shared top bar and no Admin menus. On an
// app's address the bar is the app's; on the Admin address it is named for where
// the person belongs (#501 item 3).
export function AccountLayout() {
  return (
    <ThemeChoiceProvider>
      <AccountFrame />
    </ThemeChoiceProvider>
  )
}

/** #1006: someone who can use Admin, where Admin is, stays in its frame. Anyone
 *  else has no Admin to return to, so the plain bar is all their frame. */
function AccountFrame() {
  const kind = useShellKind()
  const onAppAddress = useOnAppAddress()
  if (kind === 'admin' && onAppAddress === false) return <AdminShell fillHeight={false} account />
  // The page waits for the frame: swapping frames under it would remount it.
  const deciding = kind === 'loading' || onAppAddress === undefined
  return (
    <div className="flex h-screen flex-col bg-canvas" data-testid="account-layout">
      <TopBar forPerson />
      {/* #1235 item 7: the shared sidebar with the Account group, and the page at
          the shared x (32px from the sidebar, left-aligned, at most 880px). */}
      <div className="relative flex min-h-0 flex-1">
        <SidebarAside testid="account-sidebar" user={getSessionUser()?.row_id}>
          <AccountSidebarGroup />
        </SidebarAside>
        <main className={PAGE_PANEL} data-testid="page-panel">
          <PagePickerSlot />
          <div className="max-w-[880px]" data-testid="account-content">
            {!deciding && <Outlet />}
          </div>
        </main>
      </div>
    </div>
  )
}
