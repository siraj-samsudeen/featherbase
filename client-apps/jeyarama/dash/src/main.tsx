import { createRoot } from 'react-dom/client'
import { FeatherDash } from './app'
import { followBarTheme } from './theme'
import './style.css'

followBarTheme()
createRoot(document.getElementById('root')!).render(<FeatherDash />)
