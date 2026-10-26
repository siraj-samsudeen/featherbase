import { createContext, useContext, type ReactNode } from 'react'
import { useTheme, type Theme } from './theme'

// #489 (Codex round 1 on #495): the theme choice and its save queue live for
// the whole session, above every page. The bar's toggle can unmount (on a
// phone it is inside the Account menu), and a save it started must still land
// and update the cached whoami; a second owner would keep a second queue.
// useAppearancePreference refuses to write once the session's person changes,
// so living above sign-in and sign-out is safe.

type ThemeChoice = { theme: Theme; set: (t: Theme) => void }

const ThemeChoiceContext = createContext<ThemeChoice | null>(null)

export function ThemeChoiceProvider({ children }: { children: ReactNode }) {
  return <ThemeChoiceContext.Provider value={useTheme()}>{children}</ThemeChoiceContext.Provider>
}

/** The session's one theme choice (ThemeChoiceProvider, at the router root). */
export function useThemeChoice(): ThemeChoice {
  const choice = useContext(ThemeChoiceContext)
  if (!choice) throw new Error('useThemeChoice needs ThemeChoiceProvider above it')
  return choice
}
