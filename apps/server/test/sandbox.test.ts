// Proves the SQL sandbox: each test runs in a rolled-back transaction, the
// app's own sql.begin transactions become savepoints inside it, and nothing
// leaks between tests or into the database.

import { describe, afterAll, expect, it } from 'vitest'
import { test } from './pg-test'
import { committedTest } from './pg-test-shared'
import { withCommittedDatabase } from './committed-database'
import { _getRootSql, sql, withTransaction, usingTransaction, type Sql } from '../src/db'
import { expectRefused } from './fixtures'

// Both tests create the SAME Table and the SAME document names. Without
// sandbox isolation the second test would collide with the first's leftovers.
const DT = 'Sandbox Probe'

async function createProbeTable(admin: { post: (p: string, b?: unknown) => Promise<unknown> }) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', label: 'Title', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'qty', label: 'Qty', column_type: 'Int' },
    ],
  })
}

describe('SQL sandbox (Ecto-style rollback isolation)', () => {
  // Contract A replaces the previously investigated sibling-scheduling
  // expectation: the second helper must refuse before opening a savepoint.
  // The original failing both-order probe is retained in the evidence bundle.
  for (const method of ['withTransaction', 'sql.begin', 'tx.savepoint'])
  for (const first of ['older', 'refusal']) for (const fail of [false, true]) {
    test(`${method} overlap refuses with ${first} observed first, older ${fail ? 'fails' : 'succeeds'}`, async () => {
      await sql`create temporary table overlapping_probe (id integer primary key) on commit drop`
      await sql.begin(async tx => {
        const begin = method === 'withTransaction' ? withTransaction
          : method === 'sql.begin' ? (fn: () => Promise<void>) => sql.begin(fn)
          : (fn: () => Promise<void>) => tx.savepoint(fn)
        let enteredOlder!: () => void
        let finishOlder!: () => void
        const olderEntered = new Promise<void>(resolve => { enteredOlder = resolve })
        const olderGate = new Promise<void>(resolve => { finishOlder = resolve })
        const original = new Error('Original older failure')
        const older = begin(async () => {
          await sql`insert into overlapping_probe values (1)`
          enteredOlder()
          await olderGate
          if (fail) throw original
        })
        await olderEntered
        const refusal = begin(async () => {
          await sql`insert into overlapping_probe values (2)`
        }).then(() => undefined, error => error as Error)
        try {
          if (first === 'refusal') expect(await refusal).toMatchObject({ message: expect.stringContaining('sequential') })
        } finally {
          finishOlder()
        }
        if (fail) await expect(older).rejects.toBe(original)
        else await older
        expect(await refusal).toMatchObject({ message: expect.stringContaining('sequential') })
        await sql.begin(async tx => { await tx`insert into overlapping_probe values (3)` })
        expect((await sql`select id from overlapping_probe order by id`).map(row => row.id)).toEqual(fail ? [3] : [1, 3])
      })
    })
  }

  for (const failChild of [false, true])
  for (const fail of [false, true]) test(`an unawaited ${failChild ? 'failing' : 'successful'} child rolls back with ${fail ? 'the original failure' : 'an explicit refusal'}`, async () => {
    await sql`create temporary table unawaited_probe (id integer primary key) on commit drop`
    const original = new Error('Original enclosing failure')
    const result = withTransaction(async () => {
      void withTransaction(async () => {
        await sql`insert into unawaited_probe values (1)`
        if (failChild) throw new Error('Unawaited child failure')
      }).catch(() => {})
      if (fail) throw original
    })
    if (fail) await expect(result).rejects.toBe(original)
    else await expect(result).rejects.toThrow('must be awaited sequentially')
    expect(await sql`select * from unawaited_probe`).toHaveLength(0)
    await withTransaction(async () => { await sql`insert into unawaited_probe values (2)` })
    expect((await sql`select id from unawaited_probe`)[0].id).toBe(2)
  })

  test('an expired transaction handle cannot open another scope', async () => {
    let late!: () => Promise<unknown>
    await sql.begin(async tx => { late = () => tx.begin(async () => {}) })
    await expect(late()).rejects.toThrow('must be awaited sequentially')
    await sql.begin(async tx => { expect((await tx`select 73 as n`)[0].n).toBe(73) })
  })

  test('completed nested writes retain bounded transaction locks', async () => {
    await sql`create temporary table nested_lock_probe (id integer primary key) on commit drop`
    for (let id = 0; id < 150; id++) {
      await withTransaction(async () => {
        await sql`insert into nested_lock_probe values (${id})`
      })
      await sql.begin(async tx => {
        await tx`insert into nested_lock_probe values (${id + 150})`
      })
    }
    expect((await sql`select count(*)::int as n from nested_lock_probe`)[0].n).toBe(300)
    const [locks] = await sql`select count(*)::int as n from pg_locks
      where pid = pg_backend_pid() and locktype = 'transactionid'`
    // The sandbox owns one transaction. Completed document/import savepoints
    // must not retain one subtransaction lock per write until it ends.
    expect(locks.n).toBeLessThan(8)
  })

  test('a nested database refusal leaves the enclosing transaction usable', async () => {
    await sql`create temporary table nested_error_probe (id integer primary key) on commit drop`
    await withTransaction(async () => {
      await sql`insert into nested_error_probe values (1)`
      await expect(sql.begin(async tx => {
        // Even a caught query error must be reported by the native scope,
        // then rolled back without poisoning its enclosing transaction.
        await expect(tx`insert into nested_error_probe values (1)`).rejects.toMatchObject({ code: '23505' })
      })).rejects.toMatchObject({ code: '23505' })
      const original = new Error('Original nested callback failure')
      await expect(withTransaction(async () => {
        await sql`insert into nested_error_probe values (2)`
        throw original
      })).rejects.toBe(original)
      await sql.begin(async tx => { await tx`insert into nested_error_probe values (3)` })
    })
    expect((await sql`select id from nested_error_probe order by id`).map(row => row.id)).toEqual([1, 3])
  })

  test('a full save lifecycle (DDL + doc insert) works inside the sandbox', async ({
    admin,
    seed,
  }) => {
    await createProbeTable(admin)
    const doc = await seed(DT, { title: 'first', qty: 3 })
    expect(doc.row_id).toMatch(/^[1-9][0-9]*$/) // #855: new Tables number rows 1, 2, 3
    const listed = await admin.get<{ data: { row_id: string }[] }>(
      `/api/table/${encodeURIComponent(DT)}`,
    )
    expect(listed.data).toHaveLength(1)
  })

  test('the same Table + doc can be created again — the previous test rolled back', async ({
    admin,
    seed,
  }) => {
    await createProbeTable(admin)
    const doc = await seed(DT, { title: 'first', qty: 3 })
    expect(doc.row_id).toMatch(/^[1-9][0-9]*$/) // #855: new Tables number rows 1, 2, 3
    const listed = await admin.get<{ data: { row_id: string }[] }>(
      `/api/table/${encodeURIComponent(DT)}`,
    )
    expect(listed.data).toHaveLength(1)
  })

  test('a validation failure aborts via savepoint without killing the sandbox', async ({
    admin,
    seed,
  }) => {
    await createProbeTable(admin)
    // Missing required title → the app's save transaction (a savepoint under
    // the sandbox) rolls back cleanly...
    await expectRefused(seed(DT, { qty: 1 }), 417)
    // ...and the sandbox connection is still usable afterwards.
    const doc = await seed(DT, { title: 'after failure', qty: 2 })
    expect(doc.row_id).toMatch(/^[1-9][0-9]*$/) // #855: new Tables number rows 1, 2, 3
    // An app closing its delegated client must not close the sandbox's
    // borrowed connection (or commit the outer test transaction).
    await sql.end()
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/${doc.row_id}`))
      .toMatchObject({ title: 'after failure', qty: 2 })
  })

  test('users created in a test are sandboxed too', async ({ client, admin }) => {
    // person-rename: the harness's person gets a minted id; its address is contact data.
    expect(client.user).toMatch(/^psn_[a-z2-7]{20}$/)
    const who = await client.get<{ row_id: string }>('/api/whoami')
    expect(who.row_id).toBe(client.user)
    // Visible inside the sandbox:
    const listed = await admin.get<{ data: { row_id: string }[] }>(
      `/api/table/Person?filters=${encodeURIComponent(JSON.stringify([['row_id', '=', client.user]]))}`,
    )
    expect(listed.data).toHaveLength(1)
  })
})

// Both invocations create the same committed metadata/row: fixture teardown
// must remove it, including the admin session, before the next invocation.
for (const run of [1, 2]) committedTest(`committed request fixture restores its baseline (${run})`, async ({ admin, seed }) => {
  await createProbeTable(admin)
  const doc = await seed(DT, { title: 'committed probe', qty: 37 })
  expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/${doc.row_id}`)).toMatchObject({ title: 'committed probe', qty: 37 })
})

it('committed fixture restores state after a failing callback', async () => {
  const before = await sql`select * from series order by name`
  const original = new Error('Expected committed fixture failure')
  await expect(withCommittedDatabase(async () => {
    await sql`insert into series (name, current) values ('fixture-rollback-probe', 83)`
    await sql.unsafe('create schema fixture_empty_probe')
    throw original
  })).rejects.toBe(original)
  expect(await sql`select * from series order by name`).toEqual(before)
  expect(await sql`select nspname from pg_namespace where nspname like 'fixture_%'`).toEqual([])
})

// Not sandboxed: production HTTP requests have separate root transactions.
// Both callbacks must enter before either gate opens, so a global queue fails.
it('native query arrays retain their awaited results', async () => {
  expect(await sql.begin(tx => [tx`select 17 as n`, tx`select 31 as n`])).toEqual([[{ n: 17 }], [{ n: 31 }]])
})

it('helpers bound to an existing native transaction retain bounded locks', async () => {
  await _getRootSql().begin(tx => usingTransaction(tx as unknown as Sql, async () => {
    await sql`create temporary table adopted_probe (id integer primary key) on commit drop`
    for (let id = 0; id < 30; id++) {
      await withTransaction(async () => { await sql`insert into adopted_probe values (${id})` })
    }
    expect((await sql`select count(*)::int as n from adopted_probe`)[0].n).toBe(30)
    expect((await sql`select count(*)::int as n from pg_locks
      where pid = pg_backend_pid() and locktype = 'transactionid'`)[0].n).toBeLessThan(8)
  }))
})

for (const failed of ['withTransaction', 'sql.begin']) {
  it(`independent roots remain concurrent when ${failed} rolls back`, async () => {
    let entered = 0
    let finish!: () => void
    const gate = new Promise<void>(resolve => { finish = resolve })
    const pids = new Set<number>()
    const original = new Error('Original independent root failure')
    const older = withTransaction(async () => {
      pids.add((await sql`select pg_backend_pid() as pid`)[0].pid)
      entered++
      await gate
      if (failed === 'withTransaction') throw original
      return 19
    })
    const newer = sql.begin(async tx => {
      pids.add((await tx`select pg_backend_pid() as pid`)[0].pid)
      entered++
      await gate
      if (failed === 'sql.begin') throw original
      return 43
    })
    const settled = Promise.allSettled([older, newer])
    try { await expect.poll(() => entered).toBe(2) }
    finally { finish() }
    const results = await settled
    expect(pids.size).toBe(2)
    expect(results).toEqual(failed === 'withTransaction'
      ? [{ status: 'rejected', reason: original }, { status: 'fulfilled', value: 43 }]
      : [{ status: 'fulfilled', value: 19 }, { status: 'rejected', reason: original }])
  })
}

// The real proof: after the whole file, the database contains none of it.
afterAll(async () => {
  const root = _getRootSql()
  const [{ exists }] = await root<{ exists: boolean }[]>`
    select exists(select 1 from information_schema.tables where table_name = 'sandbox_probe')
  `
  expect(exists).toBe(false)
  const leftoverUsers = await root<{ row_id: string }[]>`
    select row_id from featherbase.person where row_id like '%@feather.test'
  `
  expect(leftoverUsers).toHaveLength(0)
})
