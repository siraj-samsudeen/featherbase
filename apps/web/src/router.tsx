import {
  Outlet,
  createRootRoute,
  createRoute,
  redirect,
} from '@tanstack/react-router'
import { LoginPage } from './pages/Login'
import { DeskLayout } from './pages/DeskLayout'
import { getToken } from './lib/api'

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

// UI-002 replaces this placeholder with the generic ListView.
const doctypeRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: '$doctype',
  component: DocTypePlaceholder,
})

function DocTypePlaceholder() {
  const { doctype } = doctypeRoute.useParams()
  return (
    <div data-testid="doctype-page">
      <h1 className="text-lg font-semibold text-gray-900">{doctype}</h1>
      <p className="mt-2 text-sm text-gray-500">List view coming with UI-002.</p>
    </div>
  )
}

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  deskRoute.addChildren([deskIndexRoute, doctypeRoute]),
])
