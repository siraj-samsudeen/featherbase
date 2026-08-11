import { useEffect, useMemo } from 'react'
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
import { TableNaming } from './components/TableNaming'
import { DashboardView } from './components/DashboardView'
import { HomePageView } from './components/HomePageView'
import { useHomePages } from './lib/home-pages'
import { JobMonitor } from './components/JobMonitor'
import { AccessTokens } from './pages/AccessTokens'
import { KanbanView } from './components/KanbanView'
import { CalendarView } from './components/CalendarView'
import { GanttView } from './components/GanttView'
import { ChecklistView } from './components/ChecklistView'
import { PrintView } from './pages/PrintView'
// PROTOTYPE — THROWAWAY (#151): ?variant= UX variants on /admin/new-table.
// PrototypeHost wraps the real TableBuilder; restore the direct import when done.
import { PrototypeHost } from './pages/table-builder-prototype/PrototypeHost'
import { ImportWizard } from './pages/ImportWizard'
import { AllTablesPage } from './pages/AllTables'
import SourceBrowser from './pages/SourceBrowser'
import { ExploreView } from './pages/Explore'
import { RelationMap } from './pages/RelationMap'

const rootRoute = createRootRoute({ component: Outlet })

// #87: every search param below is a string to the app, but TanStack's default
// search parser runs JSON.parse over each value — so a URL that was TYPED or
// pasted rather than built by an in-app navigation hands us something else:
// `?filters=[["User","enabled","=",1]]` arrives as an Array, `?report=2024` as
// a Number. A `typeof === 'string'` check then dropped the param and stripped
// it from the address bar, which quietly broke the promise that these URLs are
// shareable. Coerce back to the string the app expects instead.
function searchString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return typeof value === 'string' ? value : JSON.stringify(value)
}

// #87: `filters` is the one search param whose SHAPE matters — ListView indexes
// each entry as a [field, op, value] triple. A URL is user input, so the parsed
// value is validated, not asserted: `?filters={}` and `?filters=[null]` both
// parse as valid JSON and would otherwise reach `filters.find(...)` and throw,
// blanking the list. Anything that is not a well-formed triple array is
// discarded the way a malformed value always was.
function parseFilters(raw: string | undefined): [string, string, unknown][] {
  if (!raw) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  const ok =
    Array.isArray(value) &&
    value.every(
      (f) =>
        Array.isArray(f) &&
        f.length === 3 &&
        typeof f[0] === 'string' &&
        typeof f[1] === 'string',
    )
  return ok ? (value as [string, string, unknown][]) : []
}

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
    token: searchString(search.token),
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
    key: searchString(search.key),
  }),
  component: ResetPasswordPage,
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
    format: searchString(search.format),
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
  // PROTOTYPE — THROWAWAY: PrototypeHost renders TableBuilder unless
  // ?variant= names a UX variant. Restore <TableBuilder /> when done.
  component: () => (
    <div data-testid="doctype-page">
      <PrototypeHost />
    </div>
  ),
  // (the ?variant= param is read via window.location in the prototype, so no
  // validateSearch — adding one makes `search` required on every Link here)
})

// IMP-010: Import wizard route (before $doctype so 'import' matches).
const importRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'import',
  validateSearch: (search: Record<string, unknown>) => ({
    table: searchString(search.table),
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
    filters: searchString(search.filters),
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
  const parsed = parseFilters(filters)
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
    report: searchString(search.report),
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
    group_by: searchString(search.group_by),
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

// Checklist view: tap-first run execution for checklist-shaped Tables
// (a Sub-table column whose row table carries a Check column).
const checklistRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '$doctype/view/checklist',
  validateSearch: (search: Record<string, unknown>) => ({
    run: searchString(search.run),
  }),
  component: ChecklistPage,
})

function ChecklistPage() {
  const { doctype } = checklistRoute.useParams()
  const { run } = checklistRoute.useSearch()
  const navigate = checklistRoute.useNavigate()
  return (
    <div data-testid="doctype-page">
      <ChecklistView
        key={doctype}
        doctype={doctype}
        run={run}
        // Push, don't replace: the phone's back button should return from a
        // run to the run list.
        onRunChange={(r) => navigate({ search: { run: r } })}
      />
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

// #131: access tokens + service accounts (static segment).
const accessTokensRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'access-tokens',
  component: AccessTokens,
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

// EDS-2: the Data Source browser — introspect and reflect external tables
// (static segment, before $doctype).
const sourceBrowserRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'source/$name',
  component: SourceBrowserPage,
})

function SourceBrowserPage() {
  const { name } = sourceBrowserRoute.useParams()
  return (
    <div data-testid="doctype-page">
      <SourceBrowser key={name} name={name} />
    </div>
  )
}

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

// NAM-001: id-pattern editor for an existing Table (static first segment).
const namingRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'naming/$doctype',
  component: NamingPage,
})

function NamingPage() {
  const { doctype } = namingRoute.useParams()
  return (
    <div data-testid="doctype-page">
      <TableNaming key={doctype} doctype={doctype} />
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

// #100: `prefill` seeds a NEW row's initial values (JSON object of column →
// value) — the "+ New Attendance from this Employee" affordance. Validated
// like filters: URLs are user input, so anything that isn't a plain object
// is discarded rather than crashing the form.
function parsePrefill(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>
  } catch {
    /* fall through */
  }
  return undefined
}

// UI-004/UI-005: the generic FormView renders and saves every Table.
const docRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '$doctype/$name',
  validateSearch: (search: Record<string, unknown>) => ({
    prefill: searchString(search.prefill),
  }),
  component: TableFormPage,
})

function TableFormPage() {
  const { doctype, name } = docRoute.useParams()
  const { prefill } = docRoute.useSearch()
  // #102 review: the raw prefill string is part of the key — navigating
  // from one ?prefill= URL to another (or clearing it, e.g. Ctrl/Cmd+B)
  // remounts the form instead of retaining the previous form's values.
  // Parsing is memoized so the object isn't rebuilt every render.
  const parsedPrefill = useMemo(() => parsePrefill(prefill), [prefill])
  return (
    <div data-testid="doc-page">
      <FormView
        key={`${doctype}/${name}/${prefill ?? ''}`}
        doctype={doctype}
        name={name}
        prefill={parsedPrefill}
      />
    </div>
  )
}

// #100 pattern 4: cross-filter Explore — pane chains over reference links,
// where clicking rows IS the filter (static segment, before $doctype).
const exploreRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'explore',
  validateSearch: (search: Record<string, unknown>) => ({
    root: searchString(search.root),
  }),
  component: ExplorePage,
})

function ExplorePage() {
  const { root } = exploreRoute.useSearch()
  const navigate = exploreRoute.useNavigate()
  return (
    <div data-testid="doctype-page">
      <ExploreView
        root={root}
        onRootChange={(r) => navigate({ search: { root: r || undefined }, replace: true })}
      />
    </div>
  )
}

// #100 pattern 6: relationship map — the row's neighborhood as a walkable
// graph. `trail` carries the hop history (static first segment).
const mapRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'map/$doctype/$name',
  validateSearch: (search: Record<string, unknown>) => ({
    trail: searchString(search.trail),
  }),
  component: MapPage,
})

function MapPage() {
  const { doctype, name } = mapRoute.useParams()
  const { trail } = mapRoute.useSearch()
  return (
    <div data-testid="doctype-page">
      <RelationMap key={`${doctype}/${name}`} doctype={doctype} name={name} trail={trail} />
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
  adminRoute.addChildren([adminIndexRoute, newTableRoute, importRoute, exploreRoute, mapRoute, reportRoute, kanbanRoute, calendarRoute, ganttRoute, checklistRoute, queryReportRoute, scriptReportRoute, permissionsRoute, namingRoute, dashboardRoute, homePageRoute, allTablesRoute, sourceBrowserRoute, jobsRoute, accessTokensRoute, doctypeRoute, docRoute]),
])
