import { getSessionUser } from './api'
import { useAppearancePreference } from './appearance-preference'

// UI-024: per-user dark/light theme. The authoritative value is stored on the
// User (server); localStorage mirrors it so the theme applies instantly on load
// with no flash before whoami resolves. The mirror key is scoped by user so
// two accounts sharing a browser never see each other's theme (PR #92 review).

export type Theme = 'light' | 'dark'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

function storageKey(): string | null {
  const user = getSessionUser()
  return user ? `fc_theme:${user.row_id}` : null
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    const key = storageKey()
    if (key) localStorage.setItem(key, theme)
  } catch {
    /* ignore */
  }
}

// Apply the last-known theme immediately at module load (before React renders).
try {
  const key = storageKey()
  const saved = key ? localStorage.getItem(key) : null
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved
} catch {
  /* ignore */
}

export function useTheme(): { theme: Theme; toggle: () => void; set: (t: Theme) => void } {
  const { value: theme, set } = useAppearancePreference(
    'theme',
    isTheme(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : 'light',
    isTheme,
    applyTheme,
  )
  return { theme, toggle: () => set((previous) => previous === 'dark' ? 'light' : 'dark'), set }
}
