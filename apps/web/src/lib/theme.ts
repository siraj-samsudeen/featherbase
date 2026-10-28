import { getSessionUser } from './api'
import { useAppearancePreference } from './appearance-preference'
import { THEMES, followDevice, paintTheme, paintedChoice, type Theme } from './theme-paint'

// UI-024 / #380: the theme is light, dark, or whatever the device is set to.
// The choice is stored on the person (server); localStorage mirrors it so it
// applies before whoami resolves, under a per-person key so two accounts on
// one browser never see each other's choice (PR #92 review). Signed out there
// is no choice, so the page follows the device (clearSession calls
// followDevice). Painting itself lives in theme-paint.ts.

export { THEMES, followDevice, type Theme }
export const THEME_LABEL: Record<Theme, string> = { light: 'Light', dark: 'Dark', device: 'Same as device' }
/** The per-person mirror key; index.html's head script reads the same key. */
export const THEME_MIRROR_PREFIX = 'fc_theme:'

function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme)
}

function storageKey(): string | null {
  const user = getSessionUser()
  return user ? `${THEME_MIRROR_PREFIX}${user.row_id}` : null
}

/** Apply a person's choice and remember it on this browser for them. */
export function applyTheme(theme: Theme) {
  paintTheme(theme)
  try {
    const key = storageKey()
    if (key) localStorage.setItem(key, theme)
  } catch {
    /* ignore */
  }
}

/** Paint the signed-in person's last choice, or the device's, before React
 *  renders; whoami then repaints from the server value (a stale mirror is
 *  corrected). Each entry calls it as it starts (main.tsx, the bar's mount):
 *  never as this module loads, because in a production build this module can
 *  load before the bar has said where to paint, and over an app's page that
 *  would overwrite the app's own <html> theme (#650). */
export function paintSavedTheme() {
  try {
    const key = storageKey()
    const saved = key ? localStorage.getItem(key) : null
    paintTheme(isTheme(saved) ? saved : 'device')
  } catch {
    paintTheme('device')
  }
}

export function useTheme(): { theme: Theme; set: (t: Theme) => void } {
  const { value: theme, set } = useAppearancePreference('theme', paintedChoice(), isTheme, applyTheme)
  return { theme, set }
}
