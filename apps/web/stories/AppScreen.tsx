// A whole Admin screen in a story: the real router and components, at a given
// address, signed in as the person the recording was made by.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { routeTree } from '../src/router'
import { setSession } from '../src/lib/api'
import type { Recording } from './replay'

/** The person who made the recording, as /api/whoami answered. */
function signIn(recording: Recording) {
  const whoami = recording.answers.find((a) => a.path === '/api/whoami')?.body as Parameters<typeof setSession>[1] | undefined
  if (whoami) setSession('story-token', whoami)
}

export function AppScreen({ recording, url = recording.url }: { recording: Recording; url?: string }) {
  const [state] = useState(() => {
    signIn(recording)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [url] }) })
    return { queryClient, router }
  })
  return (
    <QueryClientProvider client={state.queryClient}>
      <RouterProvider router={state.router} />
    </QueryClientProvider>
  )
}
