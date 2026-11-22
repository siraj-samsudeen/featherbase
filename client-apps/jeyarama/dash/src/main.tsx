import { createRoot } from 'react-dom/client'
import { Dash } from './app'
import { ReportAccess } from './access-page'
import { Approvals, currentView, Unplaced, YourSections } from './sections-page'
import { YourDepartment } from './department-page'
import { YourStore } from './my-store-page'
import { WhatTheyCover } from './coverage-page'
import { AccessChangesPage } from './access-changes-page'
import { ExplainPersonPage } from './explain-person-page'
import { RolesGridPage } from './roles-grid-page'
import { movedRolesAddress } from './roles-shared'
import { followBarTheme } from './theme'
import { RecordPagesProvider } from '@featherbase/shop-floor'
import { dashPageFor } from './record-link'
import './style.css'

followBarTheme()
// #1340: Business Roles moved to Featherbase's own pages; its old address goes there.
const moved = movedRolesAddress(window.location.search)
if (moved) window.location.replace(moved)
const view = currentView()
// #1223: people, departments and sections open on Dash's own pages; other records on Featherbase.
createRoot(document.getElementById('root')!).render(<RecordPagesProvider pageFor={dashPageFor}>{view === 'sections' ? <YourSections /> : view === 'approvals' ? <Approvals /> : view === 'access' ? <ReportAccess /> : view === 'unplaced' ? <Unplaced /> : view === 'department' ? <YourDepartment /> : view === 'store' ? <YourStore /> : view === 'coverage' ? <WhatTheyCover /> : view === 'roles-grid' ? <RolesGridPage /> : view === 'explain' ? <ExplainPersonPage /> : view === 'changes' ? <AccessChangesPage /> : <Dash />}</RecordPagesProvider>)
