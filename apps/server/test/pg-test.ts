// Binding of feather-testing-postgres to THIS app's server suite. The
// sandboxed `test` fixture itself lives in ./pg-test-shared.ts, shared with
// the web component suite (apps/web/test/pg-test.ts) — see that file for
// what it wires.

import { TestApiError, type TestClient } from 'feather-testing-postgres'

export { test } from './pg-test-shared'
export { expect } from 'vitest'

// TestClient (feather-testing-postgres) predates PATCH — round 2 (#61) moved
// row updates from PUT to PATCH (Tables gain columns at runtime; a PUT from a
// client that read a row before a column existed would silently null it).
// Mirrors TestClient's own doJson exactly so existing `.rejects.toMatchObject
// ({ status, type })` assertions keep working unchanged against PATCH calls.
export async function patchDoc<T = Record<string, unknown>>(
  client: TestClient,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await client.fetch(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) })
  const json = (await res.json().catch(() => ({}))) as {
    error?: { type: string; message: string; fields?: Record<string, string> }
  }
  if (!res.ok)
    throw new TestApiError(
      res.status,
      json.error?.type ?? 'InternalError',
      json.error?.message ?? `request failed (${res.status})`,
      json.error?.fields,
    )
  return json as T
}
