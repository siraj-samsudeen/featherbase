// createPgTest: a Vitest `test` with Phoenix-style fixtures for a Hono +
// Postgres app. Every test runs inside a rolled-back transaction (see
// sandbox.ts); requests are dispatched in-process via `app.request` — no
// HTTP server, no mocks, real Postgres.

import { test as base } from 'vitest'
import { withSandbox, type SandboxHooks } from './sandbox'

export interface AppLike {
  request(input: string, init?: RequestInit): Promise<Response>
}

export interface PgTestBindings extends SandboxHooks {
  app: AppLike
  /** Mint a session token for an existing enabled user (no password needed —
   * bind to the server's issueSession). */
  mintToken(user: string): Promise<string>
  /** Create a user through the real save lifecycle; returns its document
   * name. Called inside the sandbox, so it rolls back with the test. */
  insertUser(opts: { email: string; fullName?: string; roles: string[] }): Promise<string>
  /** The administrator account name. Default: 'Administrator'. */
  adminUser?: string
}

export class TestApiError extends Error {
  status: number
  type: string
  fields?: Record<string, string>
  constructor(status: number, type: string, message: string, fields?: Record<string, string>) {
    super(`${status} ${type}: ${message}`)
    this.status = status
    this.type = type
    this.fields = fields
  }
}

export interface TestClient {
  /** The user this client is authenticated as (null = anonymous). */
  user: string | null
  token: string | null
  fetch(path: string, init?: RequestInit): Promise<Response>
  get<T = Record<string, unknown>>(path: string): Promise<T>
  post<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T>
  put<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T>
  delete<T = Record<string, unknown>>(path: string): Promise<T>
}

export function makeClient(app: AppLike, token: string | null, user: string | null): TestClient {
  async function doFetch(path: string, init: RequestInit = {}): Promise<Response> {
    // FormData bodies must keep their runtime-generated multipart boundary —
    // never force a JSON content-type onto them.
    const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData
    return app.request(path, {
      ...init,
      headers: {
        ...(isForm ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      },
    })
  }
  async function doJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await doFetch(path, init)
    const body = (await res.json().catch(() => ({}))) as {
      error?: { type: string; message: string; fields?: Record<string, string> }
    }
    if (!res.ok)
      throw new TestApiError(
        res.status,
        body.error?.type ?? 'InternalError',
        body.error?.message ?? `request failed (${res.status})`,
        body.error?.fields,
      )
    return body as T
  }
  return {
    user,
    token,
    fetch: doFetch,
    get: (path) => doJson(path),
    post: (path, body) => doJson(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    put: (path, body) => doJson(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
    delete: (path) => doJson(path, { method: 'DELETE' }),
  }
}

export type SeedFn = (
  doctype: string,
  values?: Record<string, unknown>,
) => Promise<Record<string, unknown> & { name: string }>

export type CreateUserFn = (opts?: {
  email?: string
  fullName?: string
  roles?: string[]
}) => Promise<TestClient>

export interface PgTestFixtures {
  /** The sandbox transaction handle — raw SQL access inside the test tx. */
  db: unknown
  /** Anonymous in-process client. */
  api: TestClient
  /** Administrator-authenticated client. */
  admin: TestClient
  /** A fresh regular user (created inside the sandbox) with the harness's
   * default roles. */
  client: TestClient
  /** Insert a document through the real save lifecycle as Administrator. */
  seed: SeedFn
  /** Create an additional user; returns an authenticated client. */
  createUser: CreateUserFn
}

export interface PgTestOptions {
  /** Roles granted to `client` / `createUser()` users by default. */
  defaultRoles?: string[]
}

let userCounter = 0

export function createPgTest(b: PgTestBindings, opts: PgTestOptions = {}) {
  return base.extend<PgTestFixtures>({
    // Auto fixture: EVERY test using this `test` runs sandboxed, whether or
    // not it asks for any other fixture.
    db: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await withSandbox(b, async (tx) => {
          await use(tx)
        })
      },
      { auto: true },
    ],
    api: async ({ db: _db }, use) => {
      await use(makeClient(b.app, null, null))
    },
    admin: async ({ db: _db }, use) => {
      const usr = b.adminUser ?? 'Administrator'
      await use(makeClient(b.app, await b.mintToken(usr), usr))
    },
    createUser: async ({ db: _db }, use) => {
      await use(async (o = {}) => {
        const email = o.email ?? `user-${++userCounter}@feather.test`
        const name = await b.insertUser({
          email,
          fullName: o.fullName,
          roles: o.roles ?? opts.defaultRoles ?? [],
        })
        return makeClient(b.app, await b.mintToken(name), name)
      })
    },
    client: async ({ createUser }, use) => {
      await use(await createUser())
    },
    seed: async ({ admin }, use) => {
      await use(async (doctype, values = {}) => {
        return (await admin.post('/api/save_doc', { doctype, doc: values })) as Record<
          string,
          unknown
        > & { name: string }
      })
    },
  })
}
