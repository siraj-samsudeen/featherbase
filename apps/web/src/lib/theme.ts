import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, getSessionUser } from './api'
import { useWhoAmI } from './session'

// UI-024: per-user dark/light theme. The authoritative value is stored on the
// User (server); localStorage mirrors it so the theme applies instantly on load
// with no flash before whoami resolves. The mirror key is scoped by user so
// two accounts sharing a browser never see each other's theme (PR #92 review).

export type Theme = 'light' | 'dark'

function storageKey(): string | null {
  const user = getSessionUser()
  return user ? `fc_theme:${user.name}` : null
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
  const who = useWhoAmI()
  const qc = useQueryClient()
  const [theme, setThemeState] = useState<Theme>(
    (document.documentElement.dataset.theme as Theme) || 'light',
  )

  // Sync from the server value once whoami resolves.
  useEffect(() => {
    const serverTheme = who.data?.theme
    if (serverTheme === 'light' || serverTheme === 'dark') {
      setThemeState(serverTheme)
      applyTheme(serverTheme)
    }
  }, [who.data?.theme])

  function set(next: Theme) {
    setThemeState(next)
    applyTheme(next)
    void api.post('/api/set_theme', { theme: next }).then(() => {
      // Keep the cached whoami in sync so other consumers see the new theme.
      qc.setQueryData(['whoami'], (old: unknown) =>
        old && typeof old === 'object' ? { ...(old as object), theme: next } : old,
      )
    })
  }

  return { theme, toggle: () => set(theme === 'dark' ? 'light' : 'dark'), set }
}
