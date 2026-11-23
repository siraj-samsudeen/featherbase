/// <reference types="vite/client" />
// The page's entry: paints the theme the shared top bar chose, then draws the app.
import { createRoot } from 'react-dom/client'
import { THEME_CHANGE_EVENT, paintTheme } from '@featherbase/shop-floor/theme'
import { App } from './App'
import './style.css'

// The top bar tells the page which theme it painted: on <html> once, and with an event on each change.
const painted = document.documentElement.getAttribute('data-featherbase-theme')
paintTheme(painted === 'light' || painted === 'dark' ? painted : 'device')
window.addEventListener(THEME_CHANGE_EVENT, (event) => {
  const theme = (event as CustomEvent<{ theme: 'light' | 'dark' }>).detail?.theme
  if (theme === 'light' || theme === 'dark') paintTheme(theme)
})

createRoot(document.getElementById('root')!).render(<App />)    