// Proves the SQL sandbox: each test runs in a rolled-back transaction, the
// app's own sql.begin transactions become savepoints inside it, and nothing
// leaks between tests or into the database.

import { describe, afterAll, expect } from 'vitest'
import { test } from './pg-test'
import { _getRootSql } from '../src/db'

// Both tests create the SAME DocType and the SAME document names. Without
// sandbox isolation the second test would collide with the first's leftovers.
const DT = 'Sandbox Probe'

async function createProbeDoctype(admin: { post: (p: string, b?: unknown) => Promise<unknown> }) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'title', label: 'Title', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'qty', label: 'Qty', fieldtype: 'Int' },
    ],
  })
}

describe('SQL sandbox (Ecto-style rollback isolation)', () => {
  test('a full save lifecycle (DDL + doc insert) works inside the sandbox', async ({
    admin,
    seed,
  }) => {
    await createProbeDoctype(admin)
    const doc = await seed(DT, { title: 'first', qty: 3 })
    expect(doc.name).toBeTruthy()
    const listed = await admin.get<{ data: { name: string }[] }>(
      `/api/list/${encodeURIComponent(DT)}`,
    )
    expect(listed.data).toHaveLength(1)
  })

  test('the same DocType + doc can be created again — the previous test rolled back', async ({
    admin,
    seed,
  }) => {
    await createProbeDoctype(admin)
    const doc = await seed(DT, { title: 'first', qty: 3 })
    expect(doc.name).toBeTruthy()
    const listed = await admin.get<{ data: { name: string }[] }>(
      `/api/list/${encodeURIComponent(DT)}`,
    )
    expect(listed.data).toHaveLength(1)
  })

  test('a validation failure aborts via savepoint without killing the sandbox', async ({
    admin,
    seed,
  }) => {
    await createProbeDoctype(admin)
    // Missing required title → the app's save transaction (a savepoint under
    // the sandbox) rolls back cleanly...
    await expect(seed(DT, { qty: 1 })).rejects.toMatchObject({ status: 417 })
    // ...and the sandbox connection is still usable afterwards.
    const doc = await seed(DT, { title: 'after failure', qty: 2 })
    expect(doc.name).toBeTruthy()
  })

  test('users created in a test are sandboxed too', async ({ client, admin }) => {
    expect(client.user).toMatch(/@feather\.test/)
    const who = await client.get<{ name: string }>('/api/whoami')
    expect(who.name).toBe(client.user)
    // Visible inside the sandbox:
    const listed = await admin.get<{ data: { name: string }[] }>(
      `/api/resource/User?filters=${encodeURIComponent(JSON.stringify([['name', '=', client.user]]))}`,
    )
    expect(listed.data).toHaveLength(1)
  })
})

// The real proof: after the whole file, the database contains none of it.
afterAll(async () => {
  const root = _getRootSql()
  const [{ exists }] = await root<{ exists: boolean }[]>`
    select exists(select 1 from information_schema.tables where table_name = 'tab_sandbox_probe')
  `
  expect(exists).toBe(false)
  const leftoverUsers = await root<{ name: string }[]>`
    select name from tab_user where name like '%@feather.test'
  `
  expect(leftoverUsers).toHaveLength(0)
})
