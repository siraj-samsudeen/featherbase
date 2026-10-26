import { createContext, useContext, type ReactNode } from 'react'
import { getSessionUser } from './api'
import { useTheme, type Theme } from './theme'

// #489: the theme choice and its save queue belong to the signed-in page, not
// to the toggle that shows them. On a phone the toggle is inside the Account
// menu and unmounts when it closes, and a save it started must still land and
// update the cached whoami (Codex round 1 on #495). Every signed-in shell (the
// Admin, the account pages, the Sales Target page, the Portal) wraps itself in
// ThemeChoiceProvider; the toggle and the Admin command palette read it.
//
// Codex round 2 on #495:
// - never at the router root: the hook asks whoami, and a public page (a web
//   form, a password-reset link) must make no signed-in request, or a stale
//   token left in the browser sends it to the sign-in page;
// - keyed to the signed-in person, so the next person starts with fresh state
//   and a slow save from the one before cannot hold back their own theme.

type ThemeChoice = { theme: Theme; set: (t: Theme) => void }

const ThemeChoiceContext = createContext<ThemeChoice | null>(null)

function PersonThemeChoice({ children }: { children: ReactNode }) {
  return <ThemeChoiceContext.Provider value={useTheme()}>{children}</ThemeChoiceContext.Provider>
}

export function ThemeChoiceProvider({ children }: { children: ReactNode }) {
  return <PersonThemeChoice key={getSessionUser()?.row_id ?? ''}>{children}</PersonThemeChoice>
}

/** The signed-in person's one theme choice (ThemeChoiceProvider above). */
export function useThemeChoice(): ThemeChoice {
  const choice = useContext(ThemeChoiceContext)
  if (!choice) throw new Error('useThemeChoice needs ThemeChoiceProvider above it')
  return choice
}
