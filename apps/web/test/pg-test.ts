// Binding of feather-testing-postgres for WEB component tests: the same
// sandboxed fixtures as the server suite, plus the fetch bridge so every
// `fetch('/api/...')` from the rendered UI dispatches in-process to the
// Hono app — inside the test's rolled-back Postgres transaction.

import { beforeAll } from 'vitest'
import { app } from 'server/src/index'
import { sql, _setSqlDelegate } from 'server/src/db'
import { invalidateMeta } from 'server/src/meta'
import { resetRateLimit } from 'server/src/rate-limit'
import { issueSession } from 'server/src/auth'
import { saveDoc } from 'server/src/document'
import { createPgTest, type TestClient } from 'feather-testing-postgres'
import {
  installFetchBridge,
  renderDesk as baseRenderDesk,
  renderSession as baseRenderSession,
  type RenderDeskOptions,
} from 'feather-testing-postgres/react'
import { routeTree } from '../src/router'

export const test = createPgTest(
  {
    app,
    sql,
    setDelegate: _setSqlDelegate,
    onTeardown: () => {
      invalidateMeta()
      resetRateLimit()
    },
    mintToken: async (user) => (await issueSession(user)).token,
    insertUser: async ({ email, fullName, roles }) => {
      const doc = await saveDoc(
        'User',
        {
          name: email,
          email,
          full_name: fullName ?? email.split('@')[0],
          enabled: true,
          roles: roles.map((role) => ({ role })),
        },
        'Administrator',
      )
      return String(doc.name)
    },
  },
  { defaultRoles: ['All'] },
)

beforeAll(() => {
  installFetchBridge(app)
})

type Opts = Omit<RenderDeskOptions, 'routeTree' | 'token'>

/** Render the real Desk at `path`, logged in as `as`. */
export function renderDesk(path: string, as: TestClient, opts: Opts = {}) {
  return baseRenderDesk(path, {
    routeTree,
    token: as.token,
    user: as.user ? { name: as.user } : undefined,
    ...opts,
  })
}

/** renderDesk + fluent Session. */
export function renderSession(path: string, as: TestClient, opts: Opts = {}) {
  return baseRenderSession(path, {
    routeTree,
    token: as.token,
    user: as.user ? { name: as.user } : undefined,
    ...opts,
  })
}

export { expect } from 'vitest'
