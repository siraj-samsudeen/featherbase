// #380: what the page is painted with. No imports, so lib/api.ts can call
// followDevice() from clearSession() without a cycle through lib/theme.ts.
// `data-theme` on the root is always the painted result, light or dark;
// index.css reads only that. index.html paints the same way before any script
// loads, so the first frame is already right.

export const THEMES = ['light', 'dark', 'device'] as const
export type Theme = (typeof THEMES)[number]

const DARK_QUERY = '(prefers-color-scheme: dark)'

let choice: Theme = 'device'
let watched: MediaQueryList | null = null

function deviceIsDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
}

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

/** Paint a choice, without remembering it anywhere. */
export function paintTheme(theme: Theme) {
  choice = theme
  paint()
}

/** The choice currently painted. */
export function paintedChoice(): Theme {
  return choice
}

/** Signed out: follow the device. Every sign-out comes here, through clearSession. */
export function followDevice() {
  paintTheme('device')
}
