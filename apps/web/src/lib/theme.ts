import { getSessionUser } from './api'
import { useAppearancePreference } from './appearance-preference'

// UI-024 / #380: the theme is light, dark, or whatever the device is set to.
// The choice is stored on the person (server); localStorage mirrors it so it
// applies before whoami resolves, under a per-person key so two accounts on
// one browser never see each other's choice (PR #92 review). Signed out there
// is no choice, so the page follows the device. `data-theme` on the root is
// always the painted result, light or dark; index.css reads only that.

export const THEMES = ['light', 'dark', 'device'] as const
export type Theme = (typeof THEMES)[number]
export const THEME_LABEL: Record<Theme, string> = { light: 'Light', dark: 'Dark', device: 'Same as device' }

const DARK_QUERY = '(prefers-color-scheme: dark)'

function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme)
}

function storageKey(): string | null {
  const user = getSessionUser()
  return user ? `fc_theme:${user.row_id}` : null
}

function deviceIsDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
}

let choice: Theme = 'device'
let watched: MediaQueryList | null = null

function paint() {
  document.documentElement.dataset.theme = choice === 'device' ? (deviceIsDark() ? 'dark' : 'light') : choice
  watchDevice()
}

// Repaint when the device flips between light and dark (an evening switch, a
// phone's automatic mode) while the choice is "same as device".
function onDeviceChange() {
  if (choice === 'device') document.documentElement.dataset.theme = deviceIsDark() ? 'dark' : 'light'
}
function watchDevice() {
  if (typeof window.matchMedia !== 'function') return
  watched?.removeEventListener('change', onDeviceChange)
  watched = window.matchMedia(DARK_QUERY)
  watched.addEventListener('change', onDeviceChange)
}

/** Apply a person's choice and remember it on this browser for them. */
export function applyTheme(theme: Theme) {
  choice = theme
  paint()
  try {
    const key = storageKey()
    if (key) localStorage.setItem(key, theme)
  } catch {
    /* ignore */
  }
}

/** Signed out: follow the device, and remember nothing. */
export function followDevice() {
  choice = 'device'
  paint()
}

// Before React renders: the signed-in person's last choice, or the device.
try {
  const key = storageKey()
  const saved = key ? localStorage.getItem(key) : null
  choice = isTheme(saved) ? saved : 'device'
} catch {
  choice = 'device'
}
paint()

export function useTheme(): { theme: Theme; set: (t: Theme) => void } {
  const { value: theme, set } = useAppearancePreference('theme', choice, isTheme, applyTheme)
  return { theme, set }
}
