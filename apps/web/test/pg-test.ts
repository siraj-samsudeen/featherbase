// Binding of feather-testing-postgres for WEB component tests: the same
// sandboxed `test` fixture as the server suite — imported from
// server/test/pg-test-shared, not copy-pasted (see #218) — plus the fetch
// bridge so every `fetch('/api/...')` from the rendered UI dispatches
// in-process to the Hono app, inside the test's rolled-back Postgres
// transaction.
//
// The bridge is owned here rather than taken from feather-testing-postgres
// because a rendered app outlives the code that awaits it (#426). A request
// the UI started — a query, a debounced recents flush — can still be running
// when the test body ends. Its remaining queries then ran AFTER the rollback,
// on the real pool: writes COMMITTED (a helpdesk trail later showed up in
// another file's sidebar), and the per-process meta cache was refilled with
// Tables the rollback had just removed (`relation … does not exist` in the
// NEXT test's seed). So the bridge tracks every request it dispatches, the
// `settled` fixture drains them before the sandbox rolls back, and a request
// that arrives with no sandbox open is refused instead of reaching the real
// database.

import { afterAll, beforeAll } from 'vitest'
import { test as sandboxed, committedTest as independent, isTestDatabaseOpen, sandboxRequest } from 'server/test/pg-test-shared'
import type { TestClient } from 'feather-testing-postgres'
import {
  createSession,
  renderApp as baseRenderApp,
  renderSession as baseRenderSession,
  type RenderAppOptions,
  type Session,
  type SessionOptions,
} from 'feather-testing-postgres/react'
import { routeTree } from '../src/router'
import { flushPendingEvents } from '../src/lib/recents'

const BRIDGED_PREFIXES = ['/api']
const inFlight = new Set<Promise<unknown>>()
let unbridged: typeof fetch | null = null

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError')
}

beforeAll(() => {
  const original = (unbridged = globalThis.fetch)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = /^https?:\/\//.test(url) ? new URL(url).pathname + new URL(url).search : url
    if (!BRIDGED_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?')))
      return original(input as RequestInfo, init)
    if (!isTestDatabaseOpen())
      throw new TypeError(`fetch bridge: no test sandbox is open, so ${path} was refused rather than run against the real database`)

    // The page's AbortSignal belongs to jsdom; Node's Request rejects it (#417).
    // It never crosses a real network either: aborting cancels the CLIENT's
    // wait while the server finishes the request. Model exactly that.
    const { signal, ...rest } = init ?? {}
    if (signal?.aborted) throw abortError()
    const work = sandboxRequest(path, rest)
    const tracked = work.then(
      () => {},
      () => {},
    )
    inFlight.add(tracked)
    void tracked.finally(() => inFlight.delete(tracked))
    if (!signal) return work
    return await new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
      work.then(
        (res) => {
          signal.removeEventListener('abort', onAbort)
          resolve(res)
        },
        (err) => {
          signal.removeEventListener('abort', onAbort)
          reject(err)
        },
      )
    })
  }) as typeof fetch
})

afterAll(() => {
  if (unbridged) globalThis.fetch = unbridged
})

/** Wait until every request the bridge dispatched has finished — including
 *  any a finishing request started. */
async function drainInFlight(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight])
}

// `settled` depends on `db`, so Vitest tears it down first: after afterEach
// has unmounted the app and cleared localStorage, and BEFORE the sandbox
// rolls back.
async function settledRequests({ db: _db }: { db: unknown }, use: () => Promise<void>) {
  try { await use() }
  finally {
    // The recents queue is module state that outlives the test. With the
    // session already cleared it is discarded (fail-closed), never posted
    // into the next test's sandbox under its credentials.
    flushPendingEvents()
    await drainInFlight()
  }
}
export const test = sandboxed.extend<{ settled: void }>({
  settled: [settledRequests, { auto: true }],
})
export const committedTest = independent.extend<{ settled: void }>({
  settled: [settledRequests, { auto: true }],
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

/** How long a Session verb waits for the screen: a first page load runs every
 *  query through the in-process server, which can take seconds on a busy
 *  machine. */
export const SESSION_TIMEOUT = 8000

/** The selector `session.within(...)` takes for an element's data-testid. */
export const byTestId = (id: string) => `[data-testid="${id}"]`

/** `session.within(...)` once the element with this data-testid is on screen:
 *  `within` alone looks for its element once, without waiting. */
export function inside<S extends Session>(session: S, testId: string, fn: Parameters<S['within']>[1]): S {
  return insideOf(session, byTestId(testId), fn)
}

/** `inside`, for an element named by a CSS selector (`[aria-label="Verification"]`). */
export function insideOf<S extends Session>(session: S, selector: string, fn: Parameters<S['within']>[1]): S {
  return session
    .until(`${selector} is on screen`, () => document.querySelector(selector))
    .within(selector, fn)
}

/** A Session over whatever is on screen: for pages a test mounts itself (an
 *  app's own page) rather than through renderSession. */
export const screenSession = (opts: SessionOptions = {}) => createSession({ timeout: SESSION_TIMEOUT, ...opts })
/** `screenSession()`, read as a sentence: `await onScreen().clickButton('Save')`. */
export const onScreen = () => screenSession()

/** renderApp + fluent Session. */
export function renderSession(path: string, as: TestClient, opts: Opts & { session?: SessionOptions } = {}) {
  return baseRenderSession(path, {
    routeTree,
    token: as.token,
    user: as.user ? { row_id: as.user } : undefined,
    ...opts,
    session: { timeout: SESSION_TIMEOUT, ...opts.session },
  })
}

export { expect } from 'vitest'
export type { Session } from 'feather-testing-postgres/react'
