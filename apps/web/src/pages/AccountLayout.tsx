import { Outlet } from '@tanstack/react-router'
import { TopBar, useOnAppAddress } from '../components/TopBar'
import { useShellKind } from '../lib/session'
import { AdminShell } from './AdminLayout'
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
  if (kind === 'admin' && onAppAddress === false) return <AdminShell wide={false} />
  // The page waits for the frame: swapping frames under it would remount it.
  const deciding = kind === 'loading' || onAppAddress === undefined
  return (
    <div className="flex min-h-screen flex-col bg-canvas" data-testid="account-layout">
      <TopBar forPerson />
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        {!deciding && <Outlet />}
      </main>
    </div>
  )
}
