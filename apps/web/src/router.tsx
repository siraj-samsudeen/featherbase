import { useEffect } from 'react'
import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  redirect,
} from '@tanstack/react-router'
import { LoginPage } from './pages/Login'
import { ResetPasswordPage } from './pages/ResetPassword'
import { WebFormPage } from './pages/WebForm'
import { PortalListPage, PortalRowPage } from './pages/Portal'
import { OAuthCallbackPage } from './pages/OAuthCallback'
import { AdminLayout } from './pages/AdminLayout'
import { getToken } from './lib/api'
import { ListView } from './components/ListView'
import { FormView } from './components/FormView'
import { useMeta } from './lib/meta'
import { ReportView } from './components/ReportView'
import { QueryReportView } from './components/QueryReportView'
import { ScriptReportView } from './components/ScriptReportView'
import { PermissionManager } from './components/PermissionManager'
import { DashboardView } from './components/DashboardView'
import { HomePageView } from './components/HomePageView'
import { useHomePages } from './lib/home-pages'
import { JobMonitor } from './components/JobMonitor'
import { KanbanView } from './components/KanbanView'
import { CalendarView } from './components/CalendarView'
import { GanttView } from './components/GanttView'
import { PrintView } from './pages/PrintView'
import { TableBuilder } from './pages/TableBuilder'
import { ImportWizard } from './pages/ImportWizard'
import { AllTablesPage } from './pages/AllTables'

const rootRoute = createRootRoute({ component: Outlet })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: getToken() ? '/admin' : '/login' })
  },
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
})

// WEB-002: public web form (no session required).
const webFormRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/form/$route',
  component: WebFormPage,
})

// PLAT-006: OAuth callback landing (public) — stores the token from the query
// and enters the Admin.
const oauthCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/oauth-callback',
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: OAuthCallbackRouteComponent,
})
function OAuthCallbackRouteComponent() {
  const { token } = oauthCallbackRoute.useSearch()
  return <OAuthCallbackPage token={token} />
}

// WEB-003: customer portal — a logged-in website user sees only their own
// rows (own_rows_only-scoped by the API). Lives outside the Admin shell.
const portalListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/portal/$doctype',
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: '/login' })
  },
  component: PortalListRouteComponent,
})
function PortalListRouteComponent() {
  const { doctype } = portalListRoute.useParams()
  return <PortalListPage key={doctype} doctype={doctype} />
}

const portalDocRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/portal/$doctype/$name',
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: '/login' })
  },
  component: PortalDocRouteComponent,
})
function PortalDocRouteComponent() {
  const { doctype, name } = portalDocRoute.useParams()
  return <PortalRowPage key={`${doctype}/${name}`} doctype={doctype} name={name} />
}

// SET-002: public password-reset page (target of the emailed link).
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: (search: Record<string, unknown>) => ({
    key: typeof search.key === 'string' ? search.key : undefined,
  }),
  component: ResetPasswordPage,
})

// #84: the Admin used to live under /desk. Old bookmarks, emailed row links
// and anything else pointing at the former prefix bounce to the /admin twin
// with the query string and hash intact. `replace` keeps the dead prefix out
// of history, so Back returns where the user came from.
function redirectToAdmin(href: string): never {
  throw redirect({ href: `/admin${href.slice('/desk'.length)}`, replace: true })
}

const legacyDeskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/desk',
  beforeLoad: ({ location }) => redirectToAdmin(location.href),
})

const legacyDeskSplatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/desk/$',
  beforeLoad: ({ location }) => redirectToAdmin(location.href),
})

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: '/login' })
  },
  component: AdminLayout,
})

// PRN-001: print view lives OUTSIDE the Admin layout — no navbar/sidebar.
const printRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/print/$doctype/$name',
  validateSearch: (search: Record<string, unknown>) => ({
    format: typeof search.format === 'string' ? search.format : undefined,
  }),
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: '/login' })
  },
  component: PrintPage,
})

function PrintPage() {
  const { doctype, name } = printRoute.useParams()
  const { format } = printRoute.useSearch()
  const navigate = printRoute.useNavigate()
  return (
    <PrintView
      key={`${doctype}/${name}`}
      doctype={doctype}
      name={name}
      format={format}
      onFormatChange={(f) => navigate({ search: { format: f }, replace: true })}
    />
  )
}

// #80: /admin lands on the caller's first visible Home Page; with none
// visible it falls back to a pointer at the All tables page.
const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  component: AdminIndexPage,
})

function AdminIndexPage() {
  const navigate = adminIndexRoute.useNavigate()
  const pages = useHomePages()
  const first = pages.data?.pages[0]
  useEffect(() => {
    if (first) void navigate({ to: '/admin/home/$name', params: { name: first.name }, replace: true })
  }, [first, navigate])
  if (!pages.data) return null
  if (first) return null
  return (
    <p className="text-sm text-gray-500" data-testid="admin-index-empty">
      No Home Pages are visible to you. Browse{' '}
      <Link to="/admin/all-tables" className="text-[var(--color-brand)] underline">
        All tables
      </Link>{' '}
      instead.
    </p>
  )
}

// UI-011: Table builder route (before $doctype so 'new-table' matches).
const newTableRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'new-table',
  component: () => (
    <div data-testid="doctype-page">
      <TableBuilder />
    </div>
  ),
})

// IMP-010: Import wizard route (before $doctype so 'import' matches).
const importRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'import',
  validateSearch: (search: Record<string, unknown>) => ({
    table: typeof search.table === 'string' ? search.table : undefined,
  }),
  component: () => (
    <div data-testid="doctype-page">
      <ImportWizard />
    </div>
  ),
})

// UI-002/UI-003: the generic ListView renders every Table; filters are
// URL state so they survive reloads and are shareable.
const doctypeRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '$doctype',
  validateSearch: (search: Record<string, unknown>) => ({
    filters: typeof search.filters === 'string' ? search.filters : undefined,
  }),
  component: TableListPage,
})

function TableListPage() {
  const { doctype } = doctypeRoute.useParams()
  const { filters } = doctypeRoute.useSearch()
  const navigate = doctypeRoute.useNavigate()
  const meta = useMeta(doctype)
  // SET-001: a Settings Table has no list — open its one row directly.
  if (meta.data?.kind === 'settings') {
    return (
      <div data-testid="doctype-page">
        <FormView key={doctype} doctype={doctype} name={doctype} />
      </div>
    )
  }
  let parsed: [string, string, unknown][] = []
  try {
    parsed = filters ? JSON.parse(filters) : []
  } catch {
    parsed = []
  }
  return (
    <div data-testid="doctype-page">
      <ListView
        key={doctype}
        doctype={doctype}
        filters={parsed}
        onFiltersChange={(next) =>
          navigate({
            search: { filters: next.length ? JSON.stringify(next) : undefined },
            replace: true,
          })
        }
      />
    </div>
  )
}

// RPT-001: report view — column picker + group-by with totals, generic
// over every Table. Three segments, so it never collides with
// $doctype/$name.
const reportRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '$doctype/view/report',
  validateSearch: (search: Record<string, unknown>) => ({
    report: typeof search.report === 'string' ? search.report : undefined,
  }),
  component: ReportPage,
})

function ReportPage() {
  const { doctype } = reportRoute.useParams()
  const { report } = reportRoute.useSearch()
  const navigate = reportRoute.useNavigate()
  return (
    <div data-testid="doctype-page">
      <ReportView
        key={doctype}
        doctype={doctype}
        report={report}
        onReportChange={(name) => navigate({ search: { report: name }, replace: true })}
      />
    </div>
  )
}

// UI-020: Kanban board view.
const kanbanRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '$doctype/view/kanban',
  validateSearch: (search: Record<string, unknown>) => ({
    group_by: typeof search.group_by === 'string' ? search.group_by : undefined,
  }),
  component: KanbanPage,
})

function KanbanPage() {
  const { doctype } = kanbanRoute.useParams()
  const { group_by } = kanbanRoute.useSearch()
  const navigate = kanbanRoute.useNavigate()
  return (
    <div data-testid="doctype-page">
      <KanbanView
        key={doctype}
        doctype={doctype}
        groupBy={group_by}
        onGroupByChange={(f) => navigate({ search: { group_by: f }, replace: true })}
      />
    </div>
  )
}

// UI-021: Calendar view.
const calendarRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '$doctype/view/calendar',
  component: CalendarPage,
})

function CalendarPage() {
  const { doctype } = calendarRoute.useParams()
  return (
    <div data-testid="doctype-page">
      <CalendarView key={doctype} doctype={doctype} />
    </div>
  )
}

// UI-022: Gantt view.
const ganttRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '$doctype/view/gantt',
  component: GanttPage,
})

function GanttPage() {
  const { doctype } = ganttRoute.useParams()
  return (
    <div data-testid="doctype-page">
      <GanttView key={doctype} doctype={doctype} />
    </div>
  )
}

// RPT-004: a SQL Report renders its own SQL-driven results (static first
// segment, so it wins over $doctype/$name).
const queryReportRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'query-report/$name',
  component: QueryReportPage,
})

function QueryReportPage() {
  const { name } = queryReportRoute.useParams()
  return (
    <div data-testid="doctype-page">
      <QueryReportView key={name} name={name} />
    </div>
  )
}

// RPT-005: a script report renders its declared filters + data (static segment).
const scriptReportRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'script-report/$name',
  component: ScriptReportPage,
})

function ScriptReportPage() {
  const { name } = scriptReportRoute.useParams()
  return (
    <div data-testid="doctype-page">
      <ScriptReportView key={name} name={name} />
    </div>
  )
}

// JOB-004: background job monitor (static segment).
const jobsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'jobs',
  component: JobMonitor,
})

// UI-027 / #80: a Home Page renders grouped link cards and its legacy
// shortcuts (static segment).
const homePageRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'home/$name',
  component: HomePagePage,
})

function HomePagePage() {
  const { name } = homePageRoute.useParams()
  return (
    <div data-testid="doctype-page">
      <HomePageView key={name} name={name} />
    </div>
  )
}

// #80: every table stays reachable — the sidebar's All tables entry shows
// the grouped table list (static segment, before $doctype).
const allTablesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'all-tables',
  component: AllTablesPage,
})

// UI-026: a saved Dashboard renders number cards + charts (static segment).
const dashboardRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'dashboard/$name',
  component: DashboardPage,
})

function DashboardPage() {
  const { name } = dashboardRoute.useParams()
  return (
    <div data-testid="doctype-page">
      <DashboardView key={name} name={name} />
    </div>
  )
}

// SET-003: role & permission manager for a Table (static first segment).
const permissionsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'permissions/$doctype',
  component: PermissionsPage,
})

function PermissionsPage() {
  const { doctype } = permissionsRoute.useParams()
  return (
    <div data-testid="doctype-page">
      <PermissionManager key={doctype} doctype={doctype} />
    </div>
  )
}

// UI-004/UI-005: the generic FormView renders and saves every Table.
const docRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '$doctype/$name',
  component: TableFormPage,
})

function TableFormPage() {
  const { doctype, name } = docRoute.useParams()
  return (
    <div data-testid="doc-page">
      <FormView key={`${doctype}/${name}`} doctype={doctype} name={name} />
    </div>
  )
}

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  resetPasswordRoute,
  webFormRoute,
  oauthCallbackRoute,
  portalListRoute,
  portalDocRoute,
  printRoute,
  legacyDeskRoute,
  legacyDeskSplatRoute,
  adminRoute.addChildren([adminIndexRoute, newTableRoute, importRoute, reportRoute, kanbanRoute, calendarRoute, ganttRoute, queryReportRoute, scriptReportRoute, permissionsRoute, dashboardRoute, homePageRoute, allTablesRoute, jobsRoute, doctypeRoute, docRoute]),
])
