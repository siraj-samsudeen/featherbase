import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createRouter,
  defaultStringifySearch,
} from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './router'
import { ApiError } from './lib/api'
import './index.css'

// Client errors (401/403/404/417) are definitive — retrying them just
// leaves views stuck in loading states.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 2,
    },
  },
})
// TanStack's default search stringifier writes spaces as '+', but its
// parser does NOT decode '+' back to a space — so any search value with a
// space (a filter naming the sub-table "PO Line", a text filter) would
// round-trip corrupted. A literal '+' is emitted as %2B, so every raw '+'
// in the stringified output means a space: rewrite them to %20, which the
// parser decodes correctly.
const router = createRouter({
  routeTree,
  stringifySearch: (search) => defaultStringifySearch(search).replace(/\+/g, '%20'),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
