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
// Empirical workaround (#106 review): with the default stringifySearch, a
// search VALUE containing a space (e.g. a filter naming the sub-table
// "PO Line") reproducibly reaches route components with the space replaced
// by a literal '+', in the real browser, on the pinned router versions —
// A/B verified both ways (revert → corrupts, patch → exact). The isolated
// codec (defaultStringifySearch + defaultParseSearch) round-trips the same
// value CORRECTLY in Node and the served bundle contains the correct
// URLSearchParams-based decode, so the loss happens somewhere in the
// router's runtime navigation path, not in the codec functions — root
// mechanism unidentified. The rewrite below is provably safe regardless:
// the default stringifier emits a literal '+' as %2B, so a raw '+' in its
// output can only ever mean a space (pinned by search-stringify.test.ts).
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
