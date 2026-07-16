import {
  Outlet,
  createRootRoute,
  createRoute,
  redirect,
} from '@tanstack/react-router'
import { LoginPage } from './pages/Login'
import { ResetPasswordPage } from './pages/ResetPassword'
import { WebFormPage } from './pages/WebForm'
import { DeskLayout } from './pages/DeskLayout'
import { getToken } from './lib/api'
import { ListView } from './components/ListView'
import { FormView } from './components/FormView'
import { useMeta } from './lib/meta'
import { ReportView } from './components/ReportView'
import { QueryReportView } from './components/QueryReportView'
import { ScriptReportView } from './components/ScriptReportView'
import { PermissionManager } from './components/PermissionManager'
import { DashboardView } from './components/DashboardView'
import { KanbanView } from './components/KanbanView'
import { CalendarView } from './components/CalendarView'
import { PrintView } from './pages/PrintView'
import { DocTypeBuilder } from './pages/DocTypeBuilder'

const rootRoute = createRootRoute({ component: Outlet })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: getToken() ? '/desk' : '/login' })
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

// SET-002: public password-reset page (target of the emailed link).
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: (search: Record<string, unknown>) => ({
    key: typeof search.key === 'string' ? search.key : undefined,
  }),
  component: ResetPasswordPage,
})

const deskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/desk',
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: '/login' })
  },
  component: DeskLayout,
})

// PRN-001: print view lives OUTSIDE the Desk layout — no navbar/sidebar.
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

const deskIndexRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: '/',
  component: () => (
    <p className="text-sm text-gray-500">Select a DocType from the sidebar.</p>
  ),
})

// UI-011: DocType builder route (before $doctype so 'new-doctype' matches).
const newDoctypeRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: 'new-doctype',
  component: () => (
    <div data-testid="doctype-page">
      <DocTypeBuilder />
    </div>
  ),
})

// UI-002/UI-003: the generic ListView renders every DocType; filters are
// URL state so they survive reloads and are shareable.
const doctypeRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: '$doctype',
  validateSearch: (search: Record<string, unknown>) => ({
    filters: typeof search.filters === 'string' ? search.filters : undefined,
  }),
  component: DocTypeListPage,
})

function DocTypeListPage() {
  const { doctype } = doctypeRoute.useParams()
  const { filters } = doctypeRoute.useSearch()
  const navigate = doctypeRoute.useNavigate()
  const meta = useMeta(doctype)
  // SET-001: a Single DocType has no list — open its one document directly.
  if (meta.data?.issingle) {
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
// over every DocType. Three segments, so it never collides with
// $doctype/$name.
const reportRoute = createRoute({
  getParentRoute: () => deskRoute,
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
  getParentRoute: () => deskRoute,
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
  getParentRoute: () => deskRoute,
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

// RPT-004: a Query Report renders its own SQL-driven results (static first
// segment, so it wins over $doctype/$name).
const queryReportRoute = createRoute({
  getParentRoute: () => deskRoute,
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
  getParentRoute: () => deskRoute,
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

// UI-026: a saved Dashboard renders number cards + charts (static segment).
const dashboardRoute = createRoute({
  getParentRoute: () => deskRoute,
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

// SET-003: role & permission manager for a DocType (static first segment).
const permissionsRoute = createRoute({
  getParentRoute: () => deskRoute,
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

// UI-004/UI-005: the generic FormView renders and saves every DocType.
const docRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: '$doctype/$name',
  component: DocFormPage,
})

function DocFormPage() {
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
  printRoute,
  deskRoute.addChildren([deskIndexRoute, newDoctypeRoute, reportRoute, kanbanRoute, calendarRoute, queryReportRoute, scriptReportRoute, permissionsRoute, dashboardRoute, doctypeRoute, docRoute]),
])
