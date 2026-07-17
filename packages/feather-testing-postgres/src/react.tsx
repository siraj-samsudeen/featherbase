// React integration: render the real app UI (full route tree, real router,
// real TanStack Query) in jsdom, with every fetch dispatched IN-PROCESS to
// the Hono app — which runs against the sandboxed Postgres transaction. No
// HTTP server, no mocks: component → fetch → Hono → Postgres, end to end.

import React from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router'
import type { AppLike } from './server'
import { Session, type SessionOptions } from './session'

const DEFAULT_BRIDGED_PREFIXES = ['/api', '/files', '/private/files', '/web']

/** Patch globalThis.fetch so app-relative requests hit the in-process Hono
 * app. Anything else falls through to the original fetch. Returns a restore
 * function (call it in afterEach, or rely on installing per test file). */
export function installFetchBridge(
  app: AppLike,
  prefixes: string[] = DEFAULT_BRIDGED_PREFIXES,
): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let path = url
    if (/^https?:\/\//.test(url)) {
      const u = new URL(url)
      path = u.pathname + u.search
    }
    if (prefixes.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?')))
      return app.request(path, init)
    return original(input as RequestInfo, init)
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

export interface RenderDeskOptions {
  /** The app's real route tree (e.g. `routeTree` from src/router.tsx). */
  routeTree: unknown
  /** Session token to store before rendering (from a TestClient). */
  token?: string | null
  /** localStorage keys used by the app's api client. */
  tokenKey?: string
  userKey?: string
  /** Stored user profile (the app hydrates the rest via whoami). */
  user?: { name: string; email?: string; full_name?: string | null }
  queryClient?: QueryClient
}

export interface DeskRenderResult extends RenderResult {
  router: { navigate: (opts: { to: string }) => Promise<unknown>; state: unknown }
  queryClient: QueryClient
}

/** Full-page render: mounts the real router at `path` (memory history) with a
 * fresh QueryClient. The Phoenix `conn`-test of this stack. */
export async function renderDesk(path: string, opts: RenderDeskOptions): Promise<DeskRenderResult> {
  if (opts.token) {
    localStorage.setItem(opts.tokenKey ?? 'fc_token', opts.token)
    if (opts.user)
      localStorage.setItem(
        opts.userKey ?? 'fc_user',
        JSON.stringify({ email: opts.user.name, full_name: null, ...opts.user }),
      )
  }
  const queryClient =
    opts.queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
  const history = createMemoryHistory({ initialEntries: [path] })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = createRouter({ routeTree: opts.routeTree as any, history })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...result, router: router as any, queryClient }
}

export interface SessionRenderResult extends DeskRenderResult {
  session: Session
}

/** renderDesk + a fluent Session bound to the rendered page. */
export async function renderSession(
  path: string,
  opts: RenderDeskOptions & { session?: SessionOptions },
): Promise<SessionRenderResult> {
  const result = await renderDesk(path, opts)
  const session = new Session({ root: result.baseElement as HTMLElement, ...opts.session })
  return { ...result, session }
}

export { Session, createSession, type SessionOptions } from './session'
