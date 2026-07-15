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

// UI-004 replaces this placeholder with the generic FormView.
const docRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: '$doctype/$name',
  component: DocPlaceholder,
})

function DocPlaceholder() {
  const { doctype, name } = docRoute.useParams()
  return (
    <div data-testid="doc-page">
      <h1 className="text-lg font-semibold text-gray-900">
        {doctype}: {name}
      </h1>
      <p className="mt-2 text-sm text-gray-500">Form view coming with UI-004.</p>
    </div>
  )
}

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  deskRoute.addChildren([deskIndexRoute, doctypeRoute, docRoute]),
])
