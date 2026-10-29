// Independent committing HTTP requests prove #572 and #599; sandbox savepoints
// cannot represent their overlap. Records remain in a disposable local DB.
// SECURITY_COMMIT_PROOF=1 NODE_ENV=test DATABASE_URL=postgres://...@127.0.0.1:5432/featherbase_security_concurrency_commit_e2e \
//   pnpm --filter server test test/security-concurrency-commit.test.ts
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { expect, test } from 'vitest'
import { config } from '../src/config'
import { app } from '../src/index'
import { issueSession } from '../src/auth'
import { sql, withTransaction } from '../src/db'
import { tableRelation } from '../src/table-engine'

const prove = process.env.SECURITY_COMMIT_PROOF === '1' ? test : test.skip

async function fixture() {
  const db = postgres(config.databaseUrl, { max: 1, prepare: false })
  const [identity] = await db`select current_database() as name, host(inet_server_addr()) as address,
    (select value from featherbase.internal_metadata where key = 'environment') as environment`
  expect(identity).toEqual({ name: 'featherbase_security_concurrency_commit_e2e', address: '127.0.0.1', environment: 'test' })
  const { token } = await issueSession('Administrator')
  const send = async (path: string, body?: unknown, method = 'POST') => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const table = `Security race ${randomBytes(6).toString('hex')}`
  expect((await send('/api/table_def', { name: table, id_pattern: 'prompt', columns: [{ column_name: 'amount', column_type: 'Int' }] })).status).toBe(201)
  const relation = await tableRelation(table)
  const url = `/api/table/${encodeURIComponent(table)}/original`
  const save = (table: string, row: Record<string, unknown>) => send('/api/save_row', { table, row })
  return { db, send, table, relation, url, save }
}

prove.each(['Approve', 'Reject'])('#572 concurrent Approve and %s have one winner', async competing => {
  const { db, send, table, relation, url, save } = await fixture()
  let pending: Promise<Response>[] = []
  try {
    const nextRole = `Next ${table}`
    const recipient = `next-${randomBytes(6).toString('hex')}@example.test`
    expect((await save('Role', { row_id: nextRole })).status).toBe(201)
    expect((await save('Person', { full_name: nextRole, email: recipient, enabled: true, roles: [{ role: nextRole }] })).status).toBe(201)
    expect((await save('Workflow', {
      row_id: `Flow ${table}`, ref_table: table, is_active: true,
      states: [
        { state: 'Review', target_status: 'draft' },
        { state: 'Approved', target_status: 'draft', waits_for_approval: true },
        { state: 'Rejected', target_status: 'draft', waits_for_approval: true },
        { state: 'Done', target_status: 'draft' },
      ],
      transitions: [
        { state: 'Review', action: 'Approve', next_state: 'Approved', allowed: 'System Manager', condition: 'doc.amount < 10' },
        { state: 'Review', action: 'Reject', next_state: 'Rejected', allowed: 'System Manager' },
        { state: 'Approved', action: 'Finish', next_state: 'Done', allowed: nextRole },
        { state: 'Rejected', action: 'Finish', next_state: 'Done', allowed: nextRole },
      ],
    })).status).toBe(201)
    expect((await save(table, { row_id: 'original', amount: 1 })).status).toBe(201)
    await db.begin(async tx => {
      const [{ pid }] = await tx`select pg_backend_pid() as pid`
      await tx`select 1 from ${tx(relation)} where row_id = 'original' for update`
      pending = [send(`${url}:apply_workflow_action`, { action: 'Approve' }), send(`${url}:apply_workflow_action`, { action: competing })]
      await expect.poll(async () => Number((await tx`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and pid <> ${pid} and wait_event_type = 'Lock'`)[0].n)).toBe(2)
    })
    const results = await Promise.all(pending)
    expect(results.map(r => r.status).sort()).toEqual([200, 417])
    const refused = results.find(r => r.status === 417)!
    expect(await refused.json()).toMatchObject({ error: { type: 'ValidationError', message: expect.stringContaining('not allowed from state') } })
    const actions = await db`select action, from_state, to_state from featherbase.workflow_action where ref_table = ${table}`
    expect(actions).toHaveLength(1)
    expect(actions[0].from_state).toBe('Review')
    expect(await db`select recipient from featherbase.email_queue where ref_table = ${table} and reference_name = 'original'`)
      .toEqual([{ recipient }])
    const response = await send(url, undefined, 'GET')
    expect(await response.json()).toMatchObject({ workflow_state: actions[0].to_state })
  } finally {
    await Promise.allSettled(pending)
    await db.end()
  }
}, 15_000)

prove('#572 a condition is rechecked after a concurrent row edit commits', async () => {
  const { db, send, table, relation, url, save } = await fixture()
  let pending: Promise<Response> | undefined
  try {
    expect((await save('Workflow', {
      row_id: `Flow ${table}`, ref_table: table, is_active: true,
      states: [{ state: 'Review', target_status: 'draft' }, { state: 'Approved', target_status: 'draft' }],
      transitions: [{ state: 'Review', action: 'Approve', next_state: 'Approved', allowed: 'System Manager', condition: 'doc.amount < 10' }],
    })).status).toBe(201)
    expect((await save(table, { row_id: 'original', amount: 1 })).status).toBe(201)
    await db.begin(async tx => {
      await tx`update ${tx(relation)} set amount = 100 where row_id = 'original'`
      pending = send(`${url}:apply_workflow_action`, { action: 'Approve' })
      await expect.poll(async () => Number((await tx`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`)[0].n)).toBe(1)
    })
    const refused = await pending!
    expect(refused.status).toBe(417)
    expect(await refused.json()).toMatchObject({ error: { type: 'ValidationError', message: expect.stringContaining('condition is not met') } })
    expect(await db`select action from featherbase.workflow_action where ref_table = ${table}`).toEqual([])
    expect(await (await send(url, undefined, 'GET')).json()).toMatchObject({ amount: 100, workflow_state: 'Review' })
  } finally {
    await Promise.allSettled([pending])
    await db.end()
  }
}, 15_000)

for (const kind of ['Comment', 'File', 'Share']) for (const operation of ['rename', 'delete']) for (const first of ['activity', 'parent']) {
  prove(`#599 ${kind} and ${operation} serialize with ${first} first`, async () => {
    const { db, send, table, url, save } = await fixture()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let holding = false
    let holderPid = 0
    let holder: Promise<void> | undefined
    let waiter: Promise<Response> | undefined
    try {
      expect((await save(table, { row_id: 'original', amount: 1 })).status).toBe(201)
      const activity = () => save(kind, kind === 'Share'
        ? { share_table: table, share_name: 'original', person: 'Administrator', read: true }
        : { ref_table: table, ref_name: 'original', ...(kind === 'Comment' ? { content: 'concurrent note' } : { file_name: 'metadata-only.txt' }) })
      const parent = () => operation === 'rename' ? send(`${url}:rename`, { new_name: 'renamed' }) : send(url, undefined, 'DELETE')
      holder = withTransaction(async () => {
        holderPid = Number((await sql`select pg_backend_pid() as pid`)[0].pid)
        const response = await (first === 'activity' ? activity() : parent())
        expect(response.status).toBe(first === 'activity' ? 201 : 200)
        holding = true
        await gate
      })
      await expect.poll(() => holding).toBe(true)
      waiter = first === 'activity' ? parent() : activity()
      await expect.poll(async () => Number((await db`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and ${holderPid} = any(pg_blocking_pids(pid))`)[0].n)).toBe(1)
      release()
      await holder
      const result = await waiter
      expect(result.status).toBe(first === 'parent' ? 404 : operation === 'delete' ? 417 : 200)
      const relation = kind.toLowerCase()
      const tableColumn = kind === 'Share' ? 'share_table' : 'ref_table'
      const nameColumn = kind === 'Share' ? 'share_name' : 'ref_name'
      const rows = await db`select ${db(nameColumn)} as parent from ${db(`featherbase.${relation}`)} where ${db(tableColumn)} = ${table}`
      expect(rows).toEqual(first === 'parent' ? [] : [{ parent: operation === 'rename' ? 'renamed' : 'original' }])
    } finally {
      release()
      await Promise.allSettled([holder, waiter])
      await db.end()
    }
  }, 15_000)
}
