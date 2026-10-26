import { Outlet } from '@tanstack/react-router'
import { TopBar } from '../components/TopBar'
import { ThemeChoiceProvider } from '../lib/theme-choice'

// #489 item 13: the person's own account pages, outside the Admin screens.
// Every address serves them (an app's address keeps people out of Admin), so
// they wear the shared top bar — named for the address — and no Admin menus.
export function AccountLayout() {
  return (
    <ThemeChoiceProvider>
      <div className="flex min-h-screen flex-col bg-canvas" data-testid="account-layout">
        <TopBar />
        <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </ThemeChoiceProvider>
  )
}
