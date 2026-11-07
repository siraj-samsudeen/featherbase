import { createRoot } from 'react-dom/client'
import { Dash } from './app'
import { Approvals, currentView, YourSections } from './sections-page'
import { followBarTheme } from './theme'
import './style.css'

followBarTheme()
const view = currentView()
createRoot(document.getElementById('root')!).render(view === 'sections' ? <YourSections /> : view === 'approvals' ? <Approvals /> : <Dash />)
