import { createRoot } from 'react-dom/client'
import { Dash } from './app'
import { ReportAccess } from './access-page'
import { Approvals, currentView, Unplaced, YourSections } from './sections-page'
import { YourDepartment } from './department-page'
import { YourStore } from './my-store-page'
import { WhatTheyCover } from './coverage-page'
import { followBarTheme } from './theme'
import { RecordPagesProvider } from '@featherbase/shop-floor'
import { dashPageFor } from './record-link'
import './style.css'

followBarTheme()
const view = currentView()
// #1223: people, departments and sections open on Dash's own pages; other records on Featherbase.
createRoot(document.getElementById('root')!).render(<RecordPagesProvider pageFor={dashPageFor}>{view === 'sections' ? <YourSections /> : view === 'approvals' ? <Approvals /> : view === 'access' ? <ReportAccess /> : view === 'unplaced' ? <Unplaced /> : view === 'department' ? <YourDepartment /> : view === 'store' ? <YourStore /> : view === 'coverage' ? <WhatTheyCover /> : <Dash />}</RecordPagesProvider>)
