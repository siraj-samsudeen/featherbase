// The component gallery (#380): every shared primitive, live, in the current
// theme. Served by the dev server at /gallery.html; not part of the production
// build (vite builds index.html only). It renders the real components, so it
// cannot drift from them.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { Gallery } from './Gallery'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
)
