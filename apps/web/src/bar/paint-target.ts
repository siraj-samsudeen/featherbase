import { paintOnto } from '../lib/theme-paint'

// Imported first by the bar's entry (main.tsx): lib/theme.ts paints the theme
// as it loads, and over an app's page that paint must never land on the app's
// <html>. Until the bar mounts its own root, it lands here, off the page.
paintOnto(document.createElement('div'))
