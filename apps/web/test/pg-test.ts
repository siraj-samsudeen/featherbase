// Binding of feather-testing-postgres for WEB component tests: the same
// sandboxed `test` fixture as the server suite — imported from
// server/test/pg-test-shared, not copy-pasted (see #218) — plus the fetch
// bridge so every `fetch('/api/...')` from the rendered UI dispatches
// in-process to the Hono app, inside the test's rolled-back Postgres
// transaction.

import { beforeAll } from 'vitest'
import { app } from 'server/src/index'
import { test } from 'server/test/pg-test-shared'
import type { AppLike, TestClient } from 'feather-testing-postgres'
import {
  installFetchBridge,
  renderApp as baseRenderApp,
  renderSession as baseRenderSession,
  type RenderAppOptions,
} from 'feather-testing-postgres/react'
import { routeTree } from '../src/router'

export { test }

// Stale harness type: the pinned feather-testing-postgres commit declares
// AppLike.request() -> Promise<Response>, but Hono's actual request() may
// resolve synchronously (Response | Promise<Response>). Promise.resolve
// preserves behavior exactly for every caller, which always awaits it —
// this shim is removable once the harness releases a corrected AppLike.
const appLike: AppLike = { request: (input, init) => Promise.resolve(app.request(input, init)) }

beforeAll(() => {
  installFetchBridge(appLike)
})

type Opts = Omit<RenderAppOptions, 'routeTree' | 'token'>

// Stale harness type: RenderAppOptions.user still declares { name, ... }
// from before the table-row-vocabulary rename, but the running app (see
// SessionUser in src/lib/api.ts) and this harness's own unreleased
// renderApp rename both speak { row_id }. The cast changes no value, only
// what TS believes the shape is — removable once that rename ships.
type HarnessUser = RenderAppOptions['user']
function sessionUser(as: TestClient): HarnessUser {
  return (as.user ? { row_id: as.user } : undefined) as HarnessUser
}

/** Render the real Admin at `path`, logged in as `as`. */
export function renderApp(path: string, as: TestClient, opts: Opts = {}) {
  return baseRenderApp(path, {
    routeTree,
    token: as.token,
    user: sessionUser(as),
    ...opts,
  })
}

/** renderApp + fluent Session. */
export function renderSession(path: string, as: TestClient, opts: Opts = {}) {
  return baseRenderSession(path, {
    routeTree,
    token: as.token,
    user: sessionUser(as),
    ...opts,
  })
}

export { expect } from 'vitest'
