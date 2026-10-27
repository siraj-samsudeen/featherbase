import { Outlet } from '@tanstack/react-router'
import { TopBar } from '../components/TopBar'
import { ThemeChoiceProvider } from '../lib/theme-choice'

// #489 item 13: the person's own account pages, outside the Admin screens.
// Every address serves them (an app's address keeps people out of Admin), so
// they wear the shared top bar and no Admin menus. On an app's address the bar
// is the app's; on the Admin address it is named for where the person belongs
// (#501 item 3).
export function AccountLayout() {
  return (
    <ThemeChoiceProvider>
      <div className="flex min-h-screen flex-col bg-canvas" data-testid="account-layout">
        <TopBar forPerson />
        <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </ThemeChoiceProvider>
  )
}
