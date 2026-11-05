// #950: the page takes the theme the person chose in the shared top bar. The bar writes it on
// <html> once it has painted and announces each change; Shop Floor's tokens follow data-theme.
// Before the bar has painted, the page follows the device.
import { APP_THEME_ATTRIBUTE, THEME_CHANGE_EVENT, paintTheme } from '@featherbase/shop-floor/theme'

const isPainted = (theme: unknown): theme is 'light' | 'dark' => theme === 'light' || theme === 'dark'

export function followBarTheme(): void {
  const painted = document.documentElement.getAttribute(APP_THEME_ATTRIBUTE)
  paintTheme(isPainted(painted) ? painted : 'device')
  window.addEventListener(THEME_CHANGE_EVENT, event => {
    const theme = (event as CustomEvent<{ theme?: unknown }>).detail?.theme
    if (isPainted(theme)) paintTheme(theme)
  })
}
