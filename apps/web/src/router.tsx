import { createContext, useContext, useEffect, useMemo, type ComponentType } from 'react'
import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  Navigate,
  redirect,
  useRouterState,
  useParams,
  useRouter,
} from '@tanstack/react-router'
import { parseFilters, tableSlug } from 'shared'
import { LoginPage } from './pages/Login'
import { ResetPasswordPage } from './pages/ResetPassword'
import { WebFormPage } from './pages/WebForm'
import { PortalListPage, PortalRowPage } from './pages/Portal'
import { OAuthCallbackPage } from './pages/OAuthCallback'
import { AdminLayout } from './pages/AdminLayout'
import { GoingToApp, ManageOnly } from './pages/RestrictedShell'
import { EmptyState, Notice, buttonClasses, fmtDate } from '@featherbase/shop-floor'
import { useCapabilities } from './lib/session'
import { ApiError, api, getToken, landingPath, loginHref } from './lib/api'
import { useQuery } from '@tanstack/react-query'
import { crossesFramePolicy } from './lib/document-path'
import { SalesTargetPage } from './pages/SalesTarget'
import { ListView } from './components/ListView'
import { FormView } from './components/FormView'
import { useMeta, type TableMeta } from './lib/meta'
import { ReportView } from './components/ReportView'
import { ScriptReportView } from './components/ScriptReportView'
import { PermissionManager } from './components/PermissionManager'
import { TableNaming } from './components/TableNaming'
import { DashboardView } from './components/DashboardView'
import { HomePageView } from './components/HomePageView'
import { useHomePages } from './lib/home-pages'
import { Jobs } from './pages/Jobs'
import { AccessTokens } from './pages/AccessTokens'
import { SignInMethods } from './pages/SignInMethods'
import { AccessExplanation } from './pages/AccessExplanation'
import { AccountLayout } from './pages/AccountLayout'
import { FindPerson } from './pages/FindPerson'
import { WaitingForAccess } from './pages/WaitingForAccess'
import { InstanceHealth } from './pages/InstanceHealth'
import { Apps } from './pages/Apps'
import { GlossaryPage } from './pages/Glossary'
import { FirstRunSetup, WelcomeSetup } from './pages/FirstRunSetup'
import { KanbanView } from './components/KanbanView'
import { CalendarView } from './components/CalendarView'
import { GanttView } from './components/GanttView'
import { ChecklistView } from './components/ChecklistView'
import { PrintView } from './pages/PrintView'
import { TableBuilder } from './pages/TableBuilder'
import { ImportWizard } from './pages/ImportWizard'
import { ImportBatches } from './pages/ImportBatches'
import { ColumnEditor } from './pages/ColumnEditor'
import { TableMerge } from './pages/TableMerge'
import { AllTablesPage } from './pages/AllTables'
import SourceBrowser from './pages/SourceBrowser'
import ConnectSource from './pages/ConnectSource'
import WarehouseSource from './pages/WarehouseSource'
import { WarehouseBrowser } from './pages/WarehouseBrowser'
import { CopySetup } from './pages/CopySetup'
import { CopyBar } from './components/CopyBar'
import type { BrowseContext } from './lib/warehouse'
import { ExploreView } from './pages/Explore'
import { parseChain, parseSelect } from './lib/explore-steps'
import { NavPathBar } from './components/NavPathBar'
import { PaneSplit } from './components/RowPane'
import { NavigationProvider, useAddressNavigation, useLocalNavigation } from './lib/navigation'
import type { NavStep } from './lib/nav-path'

// #642 (E4): a page with a frame policy of its own (the Sales Target report)
// is entered and left by a full load, so each document carries the policy the
// server set for the page it shows. Checked on every navigation.
const rootRoute = createRootRoute({
  component: Outlet,
  beforeLoad: ({ location }) => {
    if (crossesFramePolicy(location.pathname)) throw redirect({ href: location.href, reloadDocument: true })
  },
})

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

// #87: `filters` is validated, not asserted — see parseFilters in `shared`.

// URL spellings are never Table identities. Resolve once at the route
// boundary before mounting any consumer (including settings and tools).
function stringifyTableParams<T extends { table: string }>(params: T): T {
  return { ...params, table: tableSlug(params.table) }
}

const tableAddress = {
  params: {
    stringify: stringifyTableParams<{ table: string }>,
  },
  beforeLoad: ({ location }: { location: { href: string } }) => {
    if (!getToken()) throw redirect({ href: loginHref(location.href) })
  },
  errorComponent: TableAddressError,
}

const rowAddress = {
  ...tableAddress,
  params: { stringify: stringifyTableParams<{ table: string; name: string }> },
}

const resolvedTable = createContext<TableMeta | null>(null)

/** For the pages tablePage() wraps: the metadata its boundary resolved. */
function useTableAddress() {
  const tableMeta = useContext(resolvedTable)!
  return { table: tableMeta.name, tableMeta }
}

// Resolve through the surrounding QueryClient, just like every metadata
// consumer. Cached destinations can mount offline; new destinations still
// wait for metadata before any canonical-name operation can run.
function tablePage(Page: ComponentType) {
  return function TablePageBoundary() {
    const { table } = useParams({ strict: false }) as { table: string }
    const meta = useMeta(table)
    // A failed refresh may retain data. Connectivity loss can use it, but a
    // definitive refusal (notably ambiguity or deletion) must not mount it.
    if (meta.error instanceof ApiError && meta.error.status < 500)
      return <TableAddressError error={meta.error} />
    if (!meta.data) {
      if (meta.error) return <TableAddressError error={meta.error} />
      return <p className="p-4 text-ink-muted">Loading…</p>
    }
    return <resolvedTable.Provider value={meta.data}><Page /></resolvedTable.Provider>
  }
}

function TableAddressError({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 404 && /^Table .* not found$/.test(error.message))
    return <AdminPageNotFound />
  // #871: an old address of a renamed Table says where it went.
  const moved = error instanceof ApiError && error.status === 404 ? /^Table (.+) was renamed to (.+) by (.+) on (\S+)$/.exec(error.message) : null
  if (moved)
    return (
      <div data-testid="table-renamed">
        <EmptyState
          title={`${moved[1]} is now called ${moved[2]}`}
          body={`Renamed by ${moved[3]} on ${fmtDate(moved[4])}. Its rows and history are under the new name.`}
          action={<Link to="/featherbase/admin/table/$table" params={{ table: moved[2] }} search={{ filters: undefined }} className={buttonClasses()}>Open {moved[2]}</Link>}
        />
      </div>
    )
  return <p role="alert" className="p-4 text-negative">{error instanceof Error ? error.message : 'Could not open this Table'}</p>
}

/** Where the root sends someone: sign in, or their landing. Found on staging and production
 *  (10-Nov-2026): an app's root is served by the server, so it opens by a full page load; a router
 *  redirect to it trimmed its slash and found nothing among these pages. */
function sendFromRoot() {
  const to = getToken() ? landingPath() : '/featherbase/login'
  if (to.startsWith('/featherbase/')) throw redirect({ to })
}
const RootToApp = () => <GoingToApp path={landingPath()} />

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: sendFromRoot,
  component: RootToApp,
})

const featherbaseIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/featherbase',
  beforeLoad: sendFromRoot,
  component: RootToApp,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/featherbase/login',
  component: LoginPage,
})

// WEB-002: public web form (no session required).
const webFormRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/featherbase/form/$route',
  component: WebFormPage,
})

// PLAT-006: OAuth callback landing (public) — redeems the one-time handoff
// code from the query for a session (#150: never the token itself) and enters
// the Admin.
const oauthCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/featherbase/oauth-callback',
  validateSearch: (search: Record<string, unknown>) => ({
    code: searchString(search.code),
  }),
  component: OAuthCallbackRouteComponent,
})
function OAuthCallbackRouteComponent() {
  const { code } = oauthCallbackRoute.useSearch()
  return <OAuthCallbackPage code={code} />
}

// WEB-003: customer portal — a logged-in website user sees only their own
// rows (own_rows_only-scoped by the API). Lives outside the Admin shell.
const portalListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/featherbase/portal/$table',
  ...tableAddress,
  component: tablePage(PortalListRouteComponent),
})
function PortalListRouteComponent() {
  const { table } = useTableAddress()
  return <PortalListPage key={table} table={table} />
}

const portalDocRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/featherbase/portal/$table/$name',
  ...rowAddress,
  component: tablePage(PortalDocRouteComponent),
})
function PortalDocRouteComponent() {
  const { table } = useTableAddress()
  const { name } = portalDocRoute.useParams()
  return <PortalRowPage key={`${table}/${name}`} table={table} name={name} />
}

// #3755: the personalised sales-target report — outside the Admin shell, one
// page per signed-in employee, no selector. The server resolves the
// assignment and mints the embed session; the page only frames it.
const salesTargetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/featherbase/sales-target',
  beforeLoad: ({ location }) => {
    if (!getToken()) throw redirect({ href: loginHref(location.href) })
  },
  component: SalesTargetPage,
})

// SET-002: public password-reset page (target of the emailed link).
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/featherbase/reset-password',
  validateSearch: (search: Record<string, unknown>) => ({
    key: searchString(search.key),
  }),
  component: ResetPasswordPage,
})

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/featherbase/admin',
  beforeLoad: ({ location }) => {
    if (!getToken()) throw redirect({ href: loginHref(location.href) })
  },
  component: AdminRouteLayout,
  // Verifier, round 2 on #495: a path no Admin page matches.
  notFoundComponent: AdminPageNotFound,
})

function AdminRouteLayout() {
  const wide = useRouterState({ select: (state) => state.matches.some((match) =>
    match.routeId === sourceBrowserRoute.id || match.routeId === copySetupRoute.id,
  ) })
  // #1018: a Table's list has no reading width to keep, so a wide one gets the whole page.
  const fullWidth = useRouterState({ select: (state) => state.matches.some((match) => match.routeId === tableRoute.id) })
  return <AdminLayout wide={wide} fullWidth={fullWidth} />
}

/** An Admin path that is neither a known page nor an existing Table: said
 *  plainly, with the way back. Never the Table loader's own error. */
function AdminPageNotFound() {
  return (
    <div data-testid="page-not-found">
      <EmptyState
        title="Page not found"
        body="There is no page at this address in the Admin."
        action={<Link to="/featherbase/admin" className={buttonClasses()}>Go to the Admin home</Link>}
      />
    </div>
  )
}

// PRN-001: print view lives OUTSIDE the Admin layout — no navbar/sidebar.
const printRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/featherbase/print/$table/$name',
  ...rowAddress,
  validateSearch: (search: Record<string, unknown>) => ({
    format: searchString(search.format),
  }),
  component: tablePage(PrintPage),
})

function PrintPage() {
  const { table } = useTableAddress()
  const { name } = printRoute.useParams()
  const { format } = printRoute.useSearch()
  const navigate = printRoute.useNavigate()
  return (
    <PrintView
      key={`${table}/${name}`}
      table={table}
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
  const router = useRouter()
  const navigate = adminIndexRoute.useNavigate()
  const pages = useHomePages()
  const caps = useCapabilities()
  const first = pages.data?.pages[0]
  // #410: nothing opened to them by Table — only rows others shared, reached by
  // the link they were sent. An empty Home Page would be the same dead end.
  const sharedOnly = Boolean(caps && !caps.manage && !caps.own_grant)
  useEffect(() => {
    // Another effect may already have chosen setup while this index remains
    // mounted. Never let its stale Home redirect overwrite that destination.
    if (router.latestLocation.pathname.replace(/\/$/, '') !== adminRoute.fullPath) return
    if (first && caps && !sharedOnly) void navigate({ to: '/featherbase/admin/home/$name', params: { name: first.row_id }, replace: true })
  }, [first, caps, sharedOnly, navigate, router])
  if (!pages.data || !caps) return null
  if (sharedOnly)
    return (
      <div data-testid="shared-only">
        <EmptyState
          title="Nothing is open to you here yet"
          body="Rows shared with you open from the link you were sent. Ask your administrator if you expected to see tables here."
        />
      </div>
    )
  if (first) return null
  return (
    <p className="text-sm text-ink-muted" data-testid="admin-index-empty">
      No Home Pages are visible to you. Browse{' '}
      <Link to="/featherbase/admin/all-tables" className="text-action underline">
        All tables
      </Link>{' '}
      instead.
    </p>
  )
}

// UI-011: Table builder route (before $table so 'new-table' matches).
const newTableRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'new-table',
  component: () => (
    <div data-testid="table-page">
      <ManageOnly><TableBuilder /></ManageOnly>
    </div>
  ),
})

// IMP-010: Import wizard route (before $table so 'import' matches).
const importRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'import',
  validateSearch: (search: Record<string, unknown>) => ({
    table: searchString(search.table),
  }),
  component: () => (
    <div data-testid="table-page">
      <ManageOnly><ImportWizard /></ManageOnly>
    </div>
  ),
})

// #206: what each file-import did, as one act. Before $table, like 'import'.
const importBatchesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'imports',
  component: () => (
    <div data-testid="table-page">
      <ManageOnly><ImportBatches /></ManageOnly>
    </div>
  ),
})

// #209: change a Table's columns after its rows are in. A child of $table
// rather than a sibling: the columns belong to that Table, and the URL says
// so.
const columnsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'table/$table/columns',
  ...tableAddress,
  component: tablePage(() => (
    <div data-testid="table-page">
      <ManageOnly><ColumnEditor table={useTableAddress().table} /></ManageOnly>
    </div>
  )),
})

// #208: merge this Table's rows into another, column by column.
const mergeRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'table/$table/merge',
  ...tableAddress,
  component: tablePage(() => (
    <div data-testid="table-page">
      <ManageOnly><TableMerge table={useTableAddress().table} /></ManageOnly>
    </div>
  )),
})

// UI-002/UI-003: the generic ListView renders every Table; filters are
// URL state so they survive reloads and are shareable.
const tableRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'table/$table',
  ...tableAddress,
  // #910: `path` is the walk the user is on (lib/navigation); `filters`
  // stays the way in from elsewhere (a saved view, a shared list link).
  validateSearch: (search: Record<string, unknown>) => withPath(search, {
    filters: searchString(search.filters),
  }),
  component: tablePage(TableListPage),
})

/** A list or row page's search, with the walk's `path` when there is one:
 *  kept as the router parsed it (an object), so the address carries it once,
 *  not as a quoted string; decodePath validates either. */
function withPath<T extends object>(search: Record<string, unknown>, rest: T): T & { path?: unknown } {
  return search.path === undefined || search.path === null || search.path === '' ? rest : { ...rest, path: search.path }
}

function TableListPage() {
  const { table, tableMeta } = useTableAddress()
  const { filters, path } = tableRoute.useSearch()
  // SET-001: a Settings Table has no list — open its one row directly.
  if (tableMeta.kind === 'settings') {
    return (
      <div data-testid="table-page">
        <FormView key={table} table={table} name={table} />
      </div>
    )
  }
  return <NavigatedList key={table} table={table} filters={filters} path={path} />
}

function NavigatedList({ table, filters, path }: { table: string; filters?: string; path?: unknown }) {
  const here = useMemo<NavStep>(() => {
    const parsed = parseFilters(filters)
    return parsed.length ? { screen: 'list', table, filters: parsed } : { screen: 'list', table }
  }, [table, filters])
  const nav = useAddressNavigation(here, path)
  return (
    <div data-testid="table-page">
      {/* #772: a table copied from a data source shows where from, and Copy again. */}
      <CopyBar key={`copy-${table}`} table={table} />
      <NavigationProvider value={nav}>
        <NavPathBar />
        <PaneSplit>
          <ListView
            key={table}
            table={table}
            filters={nav.step.filters ?? []}
            onFiltersChange={(next) => {
              const { filters: _, ...step } = nav.step
              nav.push(next.length ? { ...step, filters: next } : step)
            }}
          />
        </PaneSplit>
      </NavigationProvider>
    </div>
  )
}

// RPT-001: report view — column picker + group-by with totals, generic
// over every Table. Three segments, so it never collides with
// $table/$name.
const reportRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'table/$table/view/report',
  ...tableAddress,
  validateSearch: (search: Record<string, unknown>) => ({
    report: searchString(search.report),
  }),
  component: tablePage(ReportPage),
})

function ReportPage() {
  const { table } = useTableAddress()
  const { report } = reportRoute.useSearch()
  const navigate = reportRoute.useNavigate()
  return (
    <div data-testid="table-page">
      <ReportView
        key={table}
        table={table}
        report={report}
        onReportChange={(name) => navigate({ search: { report: name }, replace: true })}
      />
    </div>
  )
}

// UI-020: Kanban board view.
const kanbanRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'table/$table/view/kanban',
  ...tableAddress,
  validateSearch: (search: Record<string, unknown>) => ({
    group_by: searchString(search.group_by),
  }),
  component: tablePage(KanbanPage),
})

function KanbanPage() {
  const { table } = useTableAddress()
  const { group_by } = kanbanRoute.useSearch()
  const navigate = kanbanRoute.useNavigate()
  return (
    <div data-testid="table-page">
      <KanbanView
        key={table}
        table={table}
        groupBy={group_by}
        onGroupByChange={(f) => navigate({ search: { group_by: f }, replace: true })}
      />
    </div>
  )
}

// UI-021: Calendar view.
const calendarRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'table/$table/view/calendar',
  ...tableAddress,
  component: tablePage(CalendarPage),
})

function CalendarPage() {
  const { table } = useTableAddress()
  return (
    <div data-testid="table-page">
      <CalendarView key={table} table={table} />
    </div>
  )
}

// UI-022: Gantt view.
const ganttRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'table/$table/view/gantt',
  ...tableAddress,
  component: tablePage(GanttPage),
})

function GanttPage() {
  const { table } = useTableAddress()
  return (
    <div data-testid="table-page">
      <GanttView key={table} table={table} />
    </div>
  )
}

// Checklist view: tap-first run execution for checklist-shaped Tables
// (a Sub-table column whose row table carries a Check column).
const checklistRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'table/$table/view/checklist',
  ...tableAddress,
  validateSearch: (search: Record<string, unknown>) => ({
    run: searchString(search.run),
  }),
  component: tablePage(ChecklistPage),
})

function ChecklistPage() {
  const { table } = useTableAddress()
  const { run } = checklistRoute.useSearch()
  const navigate = checklistRoute.useNavigate()
  return (
    <div data-testid="table-page">
      <ChecklistView
        key={table}
        table={table}
        run={run}
        // Push, don't replace: the phone's back button should return from a
        // run to the run list.
        onRunChange={(r) => navigate({ search: { run: r } })}
      />
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
    <div data-testid="table-page">
      <ScriptReportView key={name} name={name} />
    </div>
  )
}

// #464: the Jobs page (System Manager only): every scheduled job, and the
// queue monitor (JOB-004) below it.
const jobsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'jobs',
  component: () => (
    <ManageOnly><Jobs /></ManageOnly>
  ),
})

// #131: access tokens + service accounts (static segment).
const accessTokensRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'access-tokens',
  component: AccessTokens,
})

// #489 item 13: the person's own account pages, outside the Admin screens and
// served on every address, under the shared top bar.
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/featherbase/account',
  beforeLoad: ({ location }) => {
    if (!getToken()) throw redirect({ href: loginHref(location.href) })
  },
  component: AccountLayout,
})

// person-identities (#275): the signed-in person's sign-in methods.
const signInMethodsRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: 'sign-in-methods',
  component: SignInMethods,
})

// #628: what a person can see, and why. An account page, so a person without
// Admin access opens their own; the server refuses anyone else's to all but a
// System Manager.
const accessExplanationRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: 'access/$person',
  component: function AccessExplanationPage() {
    const { person } = accessExplanationRoute.useParams()
    return <AccessExplanation person={person} />
  },
})

// person-resolution: find a person by an exact identifier (an employee code
// mailed by HR) — linked from the Person list.
const findPersonRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'find-person',
  component: FindPerson,
})

// #429: people who signed in but hold no role yet (System Manager only).
// #835: the standard Person list behind the waiting filter; the person's own
// filters live in the address like any list's.
const waitingForAccessRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'waiting-for-access',
  validateSearch: (search: Record<string, unknown>) => ({
    filters: searchString(search.filters),
  }),
  component: WaitingForAccessPage,
})

function WaitingForAccessPage() {
  const { filters } = waitingForAccessRoute.useSearch()
  const navigate = waitingForAccessRoute.useNavigate()
  return (
    <ManageOnly>
      <WaitingForAccess
        filters={parseFilters(filters)}
        onFiltersChange={(next) =>
          navigate({ search: { filters: next.length ? JSON.stringify(next) : undefined }, replace: true })
        }
      />
    </ManageOnly>
  )
}

// #465 D8: instance health (System Manager only).
const instanceHealthRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'instance-health',
  component: () => (
    <ManageOnly><InstanceHealth /></ManageOnly>
  ),
})

const appsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'apps',
  component: () => <ManageOnly><Apps /></ManageOnly>,
})

// #629: the glossary (everyone signed in; static segment, before $table).
const glossaryRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'glossary',
  component: GlossaryPage,
})

// #465 D9: first-run setup (the built-in Administrator only; the page itself
// sends anyone else home).
const setupRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'setup',
  component: () => <ManageOnly><WelcomeSetup /></ManageOnly>,
})

const setupPersonRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'setup/person',
  component: FirstRunSetup,
})

// #1005: the screen's address before it took the Table's word.
const setupPeopleRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'setup/people',
  beforeLoad: () => {
    throw redirect({ to: '/featherbase/admin/setup/person', replace: true })
  },
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
    <div data-testid="table-page">
      <HomePageView key={name} name={name} />
    </div>
  )
}

// #80: every table stays reachable — the sidebar's All tables entry shows
// the grouped table list (static segment, before $table).
const allTablesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'all-tables',
  component: AllTablesPage,
})

// EDS-2: the Data Source browser — introspect and reflect external tables
// (static segment, before $table).
const sourceBrowserRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'source/$name',
  // #772: a MotherDuck source's browser keeps its place in the address.
  // #796: `connect=<schema.table>` opens a non-MotherDuck source with that table loaded and chosen.
  validateSearch: (search: Record<string, unknown>): BrowseContext & { connect?: string } => ({
    connect: searchString(search.connect),
    database: searchString(search.database),
    schema: searchString(search.schema),
    table: searchString(search.table),
    tableSchema: searchString(search.tableSchema),
    tab: searchString(search.tab),
    query: searchString(search.query),
    columnQuery: searchString(search.columnQuery),
    databaseQuery: searchString(search.databaseQuery),
    schemaQuery: searchString(search.schemaQuery),
  }),
  component: SourceBrowserPage,
})

function SourceBrowserPage() {
  const { name } = sourceBrowserRoute.useParams()
  const { connect, ...context } = sourceBrowserRoute.useSearch()
  const source = useQuery({
    queryKey: ['data-source', name],
    queryFn: () => api.get<{ engine: string }>(`/api/table/Data%20Source/${encodeURIComponent(name)}`),
  })
  if (source.isPending) return null
  if (source.error)
    return (
      <div data-testid="table-page">
        <div data-testid="source-refused" className="max-w-3xl">
          <Notice tone="negative">
            {source.error instanceof ApiError && source.error.status === 403
              ? 'Only a System Manager can open a data source.'
              : 'This data source cannot be opened.'}
          </Notice>
        </div>
      </div>
    )
  return (
    <div data-testid="table-page" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {source.data?.engine === 'motherduck'
        ? <WarehouseBrowser key={name} name={name} {...context} />
        : <SourceBrowser key={`${name}\u0000${connect ?? ''}`} name={name} connect={connect} />}
    </div>
  )
}

// #772 part 2: set up the copy of one warehouse table (static segments).
const copySetupRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'source/$name/copy',
  validateSearch: (search: Record<string, unknown>) => ({
    database: searchString(search.database),
    schema: searchString(search.schema),
    table: searchString(search.table),
    returnTo: searchString(search.returnTo),
  }),
  component: CopySetupPage,
})

function CopySetupPage() {
  const { name } = copySetupRoute.useParams()
  const { database, schema, table, returnTo } = copySetupRoute.useSearch()
  return (
    <div data-testid="table-page" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <CopySetup key={`${name}/${database}/${schema}/${table}`} name={name} database={database ?? ''} schema={schema ?? ''} table={table ?? ''} returnTo={returnTo} />
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
    <div data-testid="table-page">
      <DashboardView key={name} name={name} />
    </div>
  )
}

// NAM-001: id-pattern editor for an existing Table (static first segment).
const namingRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'table/$table/naming',
  ...tableAddress,
  component: tablePage(NamingPage),
})

function NamingPage() {
  const { table } = useTableAddress()
  return (
    <div data-testid="table-page">
      <TableNaming key={table} table={table} />
    </div>
  )
}

// SET-003: role & permission manager for a Table (static first segment).
const permissionsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'table/$table/permissions',
  ...tableAddress,
  component: tablePage(PermissionsPage),
})

function PermissionsPage() {
  const { table } = useTableAddress()
  return (
    <div data-testid="table-page">
      <PermissionManager key={table} table={table} />
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
  path: 'table/$table/row/$name',
  ...rowAddress,
  validateSearch: (search: Record<string, unknown>) => withPath(search, {
    prefill: searchString(search.prefill),
  }),
  component: tablePage(TableFormPage),
})

function TableFormPage() {
  const { table, tableMeta } = useTableAddress()
  const { name } = docRoute.useParams()
  const { prefill, path } = docRoute.useSearch()
  const here = useMemo<NavStep>(() => ({ screen: 'row', table, row: name }), [table, name])
  const nav = useAddressNavigation(here, path)
  // #1021: a view's row is its base's row, and opens as one.
  if (tableMeta.kind === 'view' && tableMeta.view_of)
    return <Navigate to="/featherbase/admin/table/$table/row/$name" params={{ table: tableMeta.view_of, name }} search={{ prefill: undefined }} replace />
  // #102 review: the raw prefill string is part of the key — navigating
  // from one ?prefill= URL to another (or clearing it, e.g. g then n)
  // remounts the form instead of retaining the previous form's values.
  // Parsing is memoized so the object isn't rebuilt every render.
  const parsedPrefill = useMemo(() => parsePrefill(prefill), [prefill])
  // #772: Data Source's New page is the guided connect page; a MotherDuck
  // source's page shows its token by last four only (any other source keeps the form).
  if (table === 'Data Source') {
    return (
      <div data-testid="doc-page">
        {name === 'new' ? <ConnectSource /> : <WarehouseSource key={name} name={name} />}
      </div>
    )
  }
  return (
    <div data-testid="doc-page">
      <NavigationProvider value={nav}>
        <NavPathBar />
        <PaneSplit onFocus={(pane) => nav.push({ screen: 'row', table: pane.table, row: pane.row, ...(nav.step.view ? { view: nav.step.view } : {}) })}>
          <FormView
            key={`${table}/${name}/${prefill ?? ''}`}
            table={table}
            name={name}
            prefill={parsedPrefill}
          />
        </PaneSplit>
      </NavigationProvider>
    </div>
  )
}

const newRowRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'table/$table/new',
  ...tableAddress,
  validateSearch: (search: Record<string, unknown>) => ({ prefill: searchString(search.prefill) }),
  component: tablePage(NewRowPage),
})

function NewRowPage() {
  const { table, tableMeta } = useTableAddress()
  const { prefill } = newRowRoute.useSearch()
  const parsedPrefill = useMemo(() => parsePrefill(prefill), [prefill])
  // #1021: a view holds no rows; a new row is added to its base.
  if (tableMeta.kind === 'view' && tableMeta.view_of)
    return (
      <div data-testid="view-new-row">
        <Notice tone="info">
          <span>
            {table} is a view of {tableMeta.view_of} and holds no rows of its own.{' '}
            <Link to="/featherbase/admin/table/$table/new" params={{ table: tableMeta.view_of }} search={{ prefill: undefined }}
              className="font-medium text-action hover:underline" data-testid="view-new-row-base">
              Add a {tableMeta.view_of} row
            </Link>{' '}
            instead; it shows here when it matches the view.
          </span>
        </Notice>
      </div>
    )
  if (table === 'Data Source') return <div data-testid="doc-page"><ConnectSource /></div>
  return <div data-testid="doc-page"><FormView key={`${table}/new/${prefill ?? ''}`} table={table} name="" isNew prefill={parsedPrefill} /></div>
}

// #100 pattern 4: cross-filter Explore — pane chains over reference links,
// where clicking rows IS the filter (static segment, before $table).
const exploreRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'explore',
  validateSearch: (search: Record<string, unknown>) => ({
    root: searchString(search.root),
    // Entry points (ListView split button, the row page's Map tab) deep-link a whole
    // workspace: `chain` pre-builds step2/step3, `select` preselects pane 1.
    // Both are validated the parseFilters way — malformed means absent.
    chain: searchString(search.chain),
    select: searchString(search.select),
  }),
  component: ExplorePage,
})

function ExplorePage() {
  const { root, chain, select } = exploreRoute.useSearch()
  const navigate = exploreRoute.useNavigate()
  // #910: Explore keeps its own chain; its drill pane walks in memory.
  const nav = useLocalNavigation({ screen: 'list', table: root || 'Explore' })
  return (
    <div data-testid="table-page">
      <NavigationProvider value={nav}>
      <PaneSplit>
      {/* Params initialize state, they are not two-way bound — in-view step
          and selection changes stay pure state (#87 keeps root shareable;
          the chain/select params exist for the entry points). The key
          remounts the workspace when a navigation hands us new params. */}
      <ExploreView
        key={`${root ?? ''}|${chain ?? ''}|${select ?? ''}`}
        root={root}
        initialChain={parseChain(chain)}
        initialSelect={parseSelect(select)}
        onRootChange={(r) =>
          navigate({
            // A root change is a fresh workspace — any deep-linked chain and
            // selection belonged to the old root, so they leave the URL too.
            search: { root: r || undefined, chain: undefined, select: undefined },
            replace: true,
          })
        }
      />
      </PaneSplit>
      </NavigationProvider>
    </div>
  )
}

export const routeTree = rootRoute.addChildren([
  indexRoute,
  featherbaseIndexRoute,
  loginRoute,
  resetPasswordRoute,
  webFormRoute,
  oauthCallbackRoute,
  portalListRoute,
  portalDocRoute,
  salesTargetRoute,
  accountRoute.addChildren([signInMethodsRoute, accessExplanationRoute]),
  printRoute,
  adminRoute.addChildren([adminIndexRoute, newTableRoute, importRoute, importBatchesRoute, columnsRoute, mergeRoute, exploreRoute, reportRoute, kanbanRoute, calendarRoute, ganttRoute, checklistRoute, scriptReportRoute, permissionsRoute, namingRoute, dashboardRoute, homePageRoute, allTablesRoute, sourceBrowserRoute, copySetupRoute, jobsRoute, accessTokensRoute, findPersonRoute, waitingForAccessRoute, instanceHealthRoute, appsRoute, glossaryRoute, setupRoute, setupPersonRoute, setupPeopleRoute, tableRoute, docRoute, newRowRoute]),
])
