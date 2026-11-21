import { createRoot } from 'react-dom/client'
import { APP_THEME_ATTRIBUTE, THEME_CHANGE_EVENT, paintTheme } from '@featherbase/shop-floor/theme'
import { ForecastingApp } from './App'
import './style.css'

// The page takes the theme the person chose in the shared top bar; before it paints, the device's.
const painted = document.documentElement.getAttribute(APP_THEME_ATTRIBUTE)
paintTheme(painted === 'light' || painted === 'dark' ? painted : 'device')
window.addEventListener(THEME_CHANGE_EVENT, event => {
  const theme = (event as CustomEvent<{ theme?: unknown }>).detail?.theme
  if (theme === 'light' || theme === 'dark') paintTheme(theme)
})

createRoot(document.getElementById('root')!).render(<ForecastingApp />)
