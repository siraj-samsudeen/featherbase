// Binding of feather-testing-postgres for WEB component tests: the same
// sandboxed `test` fixture as the server suite — imported from
// server/test/pg-test-shared, not copy-pasted (see #218) — plus the fetch
// bridge so every `fetch('/api/...')` from the rendered UI dispatches
// in-process to the Hono app, inside the test's rolled-back Postgres
// transaction.

import { beforeAll } from 'vitest'
import { app } from 'server/src/index'
import { test } from 'server/test/pg-test-shared'
import type { TestClient } from 'feather-testing-postgres'
import {
  installFetchBridge,
  renderApp as baseRenderApp,
  renderSession as baseRenderSession,
  type RenderAppOptions,
} from 'feather-testing-postgres/react'
import { routeTree } from '../src/router'

export { test }

beforeAll(() => {
  installFetchBridge(app)
})

type Opts = Omit<RenderAppOptions, 'routeTree' | 'token'>

/** Render the real Admin at `path`, logged in as `as`. */
export function renderApp(path: string, as: TestClient, opts: Opts = {}) {
  return baseRenderApp(path, {
    routeTree,
    token: as.token,
    user: as.user ? { row_id: as.user } : undefined,
    ...opts,
  })
}

/** renderApp + fluent Session. */
export function renderSession(path: string, as: TestClient, opts: Opts = {}) {
  return baseRenderSession(path, {
    routeTree,
    token: as.token,
    user: as.user ? { row_id: as.user } : undefined,
    ...opts,
  })
}

export { expect } from 'vitest'
