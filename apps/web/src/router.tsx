import {
  Outlet,
  createRootRoute,
  createRoute,
  redirect,
} from '@tanstack/react-router'
import { LoginPage } from './pages/Login'
import { DeskLayout } from './pages/DeskLayout'
import { getToken } from './lib/api'
import { ListView } from './components/ListView'
import { FormView } from './components/FormView'
import { ReportView } from './components/ReportView'
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

const deskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/desk',
  beforeLoad: () => {
    if (!getToken()) throw redirect({ to: '/login' })
  },
  component: DeskLayout,
})

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
  deskRoute.addChildren([deskIndexRoute, newDoctypeRoute, reportRoute, doctypeRoute, docRoute]),
])
