// Shared setup helpers for the server suite (#220).
//
// Every test file used to grow its own `setup()`/`makeDT()` builder that
// POSTed /api/table_def and hand-encoded the same three URLs, and the
// Role -> Permission -> user triple was hand-rolled in 22 files. The shapes
// drifted; this module is the one place they live now.
//
// These are *plumbing* helpers only. They never assert (except
// `expectApiError`, whose whole job is the assertion) and they take every
// name as an argument, so a file keeps owning its own Table and role
// constants — the sandbox still rolls all of it back per test.
//
// This file deliberately imports nothing from ./pg-test: pg-test re-exports
// `patchDoc` from here, and a cycle between the two would be gratuitous.

import { expect } from 'vitest'
import { TestApiError, type CreateUserFn, type TestClient } from 'feather-testing-postgres'

// ---------------------------------------------------------------- requests

// Read the server's error envelope off a failed Response and rebuild the
// TestApiError that TestClient's own get/post/delete would have thrown. The
// shape (status, type, message, fields) is what the suite's 170-odd
// `.rejects.toMatchObject({ status, type })` assertions match against.
async function apiErrorFrom(res: Response): Promise<TestApiError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { type: string; message: string; fields?: Record<string, string> }
  }
  return new TestApiError(
    res.status,
    body.error?.type ?? 'InternalError',
    body.error?.message ?? `request failed (${res.status})`,
    body.error?.fields,
  )
}

// TestClient (feather-testing-postgres) predates PATCH — round 2 (#61) moved
// row updates from PUT to PATCH (Tables gain columns at runtime; a PUT from a
// client that read a row before a column existed would silently null it).
// Mirrors TestClient's own doJson exactly so existing `.rejects.toMatchObject
// ({ status, type })` assertions keep working unchanged against PATCH calls.
// Re-exported from ./pg-test, which is where the suite imports it from.
export async function patchDoc<T = Record<string, unknown>>(
  client: TestClient,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await client.fetch(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) })
  if (!res.ok) throw await apiErrorFrom(res)
  return (await res.json().catch(() => ({}))) as T
}

// Assert that an API call fails, in the shape the admin-side already uses:
//
//   await expect(admin.post(url, body)).rejects.toMatchObject({ status: 417 })
//   await expectApiError(user.post(url, body), { status: 403 })
//
// The admin idiom works because TestClient's get/post/put/delete (and
// `patchDoc` above) throw a TestApiError. An expected-failure request as a
// non-admin used to have no such path when it needed a raw `client.fetch` —
// a custom method, FormData, extra headers — so those collapsed into
// `expect((await user.fetch(...)).status).toBe(403)` pyramids. This accepts
// either: a promise that rejects with TestApiError, or one that resolves to
// a non-ok Response, and matches the same envelope against `expected`.
//
// `expected` is passed straight to toMatchObject, so asymmetric matchers
// work: `{ status: 417, fields: { qty: expect.stringMatching(/required/) } }`.
export async function expectApiError(
  call: Promise<unknown>,
  expected: Record<string, unknown> & { status: number },
): Promise<TestApiError> {
  let resolved: unknown
  try {
    resolved = await call
  } catch (err) {
    if (!(err instanceof TestApiError)) throw err
    expect(err).toMatchObject(expected)
    return err
  }
  if (resolved instanceof Response && !resolved.ok) {
    const err = await apiErrorFrom(resolved)
    expect(err).toMatchObject(expected)
    return err
  }
  const got = resolved instanceof Response ? String(resolved.status) : JSON.stringify(resolved)
  throw new Error(`expected the request to fail with ${expected.status}, but it succeeded: ${got}`)
}

// ------------------------------------------------------------------ tables

// A column, either spelled out or in the shorthand the call sites want:
// 'title' is a Data column, 'qty:Int' names its type. Anything with options
// (reference_table, choices, reqd, tier, ...) stays an object.
export type ColumnSpec = string | Record<string, unknown>

export interface TableDef extends Record<string, unknown> {
  name: string
  columns?: ColumnSpec[]
}

// Handles to one Table's URLs, so `encodeURIComponent` is spelled once here
// instead of 399 times across the suite.
export interface TableRef {
  /** The Table's row_id — what a save_row/import body's `table:` wants. */
  name: string
  /** Collection: /api/table/<name> */
  url: string
  /** Metadata: /api/table/<name>:meta */
  metaUrl: string
  /** The Table's own definition row: /api/table_def/<name> */
  defUrl: string
  /** One row: /api/table/<name>/<id> */
  rowUrl(id: string): string
  /** Collection with a query string; non-string values are JSON-encoded, so
   *  `listUrl({ fields: ['row_id', 'title'] })` is the common case. */
  listUrl(params: Record<string, unknown>): string
}

/** URL handles for a Table that already exists (a built-in, say). */
export function tableRef(name: string): TableRef {
  const enc = encodeURIComponent(name)
  const url = `/api/table/${enc}`
  return {
    name,
    url,
    metaUrl: `${url}:meta`,
    defUrl: `/api/table_def/${enc}`,
    rowUrl: (id) => `${url}/${encodeURIComponent(id)}`,
    listUrl: (params) => {
      const q = Object.entries(params)
        .map(
          ([k, v]) =>
            `${k}=${encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))}`,
        )
        .join('&')
      return q ? `${url}?${q}` : url
    },
  }
}

// Create a Table and hand back its URL handles. Everything other than
// `columns` is passed through to /api/table_def verbatim (id_pattern, kind,
// is_submittable, data_source, ...) — this expands the column shorthand and
// owns the URL encoding, nothing more.
export async function makeTable(admin: TestClient, def: TableDef): Promise<TableRef> {
  const { columns, ...rest } = def
  await admin.post('/api/table_def', {
    ...rest,
    ...(columns ? { columns: columns.map(toColumn) } : {}),
  })
  return tableRef(def.name)
}

function toColumn(spec: ColumnSpec): Record<string, unknown> {
  if (typeof spec !== 'string') return spec
  const [column_name, column_type = 'Data'] = spec.split(':')
  return { column_name, column_type }
}

// -------------------------------------------------------------- permissions

export interface GrantSpec extends Record<string, unknown> {
  role: string
  /** One Table or several — a Permission row is written for each. */
  table: string | string[]
}

// The Role -> Permission dance the suite performs by hand in 22 files: make
// sure the Role row exists, then write one Permission row per Table with the
// remaining keys (can_read, can_write, can_create, can_delete, tier,
// own_rows_only, ...) as the grant.
//
// The Role is only created when it is missing, because a second call for the
// same role is normal: widening access mid-test by adding a *further*
// Permission row (an unconditional read on top of an own_rows_only grant, say)
// is a thing several tests do deliberately, and re-saving the Role row would
// hit optimistic locking. Built-in roles like 'All' therefore just work.
//
// Pass `table: []` to create the Role and no grants at all — the world a
// "with zero Permission rows everything is 403" test needs.
//
// Returns the Permission row ids, in the order the Tables were given.
export async function grantRole(admin: TestClient, spec: GrantSpec): Promise<string[]> {
  const { role, table, ...perms } = spec
  const existing = await admin.fetch(`/api/table/Role/${encodeURIComponent(role)}`)
  if (existing.status === 404)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: role } })

  const tables = Array.isArray(table) ? table : [table]
  const ids: string[] = []
  for (const ref_table of tables) {
    const row = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Permission',
      row: { ref_table, role, ...perms },
    })
    ids.push(String(row.row_id))
  }
  return ids
}

// grantRole + the `createUser` fixture, for the very common "a user who can
// do exactly this much" setup. The user carries only the granted role, so
// whatever the grant omits is genuinely denied.
export async function createUserWithRole(
  admin: TestClient,
  createUser: CreateUserFn,
  spec: GrantSpec,
  user: { email?: string; fullName?: string } = {},
): Promise<TestClient> {
  await grantRole(admin, spec)
  return createUser({ ...user, roles: [spec.role] })
}
