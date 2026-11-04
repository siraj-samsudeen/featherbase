import { serve } from '@hono/node-server'
import { expect, test } from 'vitest'
import { app } from '../src/index'
import { sql, withTransaction } from '../src/db'
import { registerApp, installApp, uninstallApp } from '../src/apps'
import { saveDoc, saveSystemRow, deleteDoc } from '../src/document'
import { issueSession } from '../src/auth'
import { provisionApp } from '../src/app-lifecycle'

// Savepoints cannot prove a decision is recomputed after another connection
// commits a revocation. Run only against this disposable committed-proof DB.
const prove = process.env.DOMAIN_ADMINISTRATION_COMMIT_PROOF === '1' ? test : test.skip

prove('a public correction rechecks scoped authority after a competing change commits', async () => {
  expect((await sql`select current_database() as name,
    (select value from internal_metadata where key = 'environment') as environment`)[0])
    .toEqual({ name: 'featherbase_issue462_administration_commit_test', environment: 'test' })
  const person = await saveDoc('Person', { email: 'scope-race@example.test', full_name: 'Scope race', enabled: true }, 'Administrator', 'insert')
  const user = String(person.row_id)
  registerApp({ name: 'scoperace',
    administration: { version: 1, targets: { 'scoperace.contact': { person: 'person' } },
      memberships: { table: 'scoperace.membership', person: 'person', dimensions: { store: ['store'] } } },
    tables: [
      { name: 'scoperace.contact', id_pattern: 'prompt', columns: [
        { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
        { column_name: 'phone', column_type: 'Data' },
      ] },
      { name: 'scoperace.membership', id_pattern: 'prompt', columns: [
        { column_name: 'person', column_type: 'Reference', reference_table: 'Person' },
        { column_name: 'store', column_type: 'Data' },
      ] },
    ], roles: ['Scope Race Editor'],
    permissions: [{ table: 'scoperace.contact', role: 'Scope Race Editor', operations: { read: ['phone'], update: ['phone'] } }],
  })
  await installApp('scoperace')
  await provisionApp('scoperace', async () => {
    await saveDoc('scoperace.contact', { row_id: 'contact', person: user, phone: 'original' })
    await saveDoc('scoperace.membership', { row_id: 'membership', person: user, store: 'A' })
  })
  const scope = await saveSystemRow('Scope', { app: 'scoperace', mode: 'named', tuples: [{ store: 'A' }] }, 'provisioning')
  const assignment = await saveSystemRow('Role Assignment', { app: 'scoperace', person: user,
    role: 'Scope Race Editor', scope: scope.row_id }, 'provisioning')
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const { token } = await issueSession(user)
    const send = (row: unknown) => fetch(`http://127.0.0.1:${address.port}/api/save_row`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'scoperace.contact', row }),
    })
    const [initial] = await sql`select updated_at from scoperace.contact where row_id = 'contact'`
    const positive = await send({ row_id: 'contact', phone: 'control', updated_at: initial.updated_at })
    expect(positive.status).toBe(201)
    const [current] = await sql`select updated_at, phone from scoperace.contact where row_id = 'contact'`
    expect(current.phone).toBe('control')
    for (const cause of ['assignment', 'membership', 'principal']) {
      let release!: () => void
      let locked!: () => void
      const ready = new Promise<void>(resolve => { locked = resolve })
      const gate = new Promise<void>(resolve => { release = resolve })
      const holder = withTransaction(async () => {
        if (cause === 'assignment') await sql`update featherbase.role_assignment set ends_on = '2000-01-01'
          where row_id = ${String(assignment.row_id)}`
        else if (cause === 'principal') await sql`update featherbase.person set enabled = false where row_id = ${user}`
        else await sql`update scoperace.membership set store = 'B' where row_id = 'membership'`
        locked()
        await gate
      })
      let request: Promise<Response> | undefined
      try {
        await ready
        request = send({ row_id: 'contact', phone: 'must-not-save', updated_at: current.updated_at })
        await expect.poll(async () => Number((await sql`select count(*) as n from pg_stat_activity
          where datname = current_database() and wait_event = 'relation'`)[0].n)).toBeGreaterThan(0)
        release()
        await holder
        expect((await request).status).toBe(403)
        expect((await sql`select phone from scoperace.contact where row_id = 'contact'`)[0].phone).toBe('control')
      } finally {
        release()
        await Promise.allSettled([holder, request])
        await sql`update featherbase.role_assignment set ends_on = null where row_id = ${String(assignment.row_id)}`
        await sql`update scoperace.membership set store = 'A' where row_id = 'membership'`
        await sql`update featherbase.person set enabled = true where row_id = ${user}`
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await sql`delete from featherbase.role_assignment where row_id = ${String(assignment.row_id)}`
    await sql`delete from featherbase.scope where row_id = ${String(scope.row_id)}`
    await uninstallApp('scoperace')
    await deleteDoc('Person', user, 'Administrator')
  }
}, 30_000)

prove('concurrent reviews apply the exact proposal revision once', async () => {
  expect((await sql`select current_database() as name,
    (select value from internal_metadata where key = 'environment') as environment`)[0])
    .toEqual({ name: 'featherbase_issue462_administration_commit_test', environment: 'test' })
  const maker = await saveDoc('Person', { email: 'maker-race@example.test', full_name: 'Maker race', enabled: true }, 'Administrator', 'insert')
  const reviewer = await saveDoc('Person', { email: 'review-race@example.test', full_name: 'Reviewer race', enabled: true }, 'Administrator', 'insert')
  const table = 'reviewrace.contact'
  registerApp({ name: 'reviewrace', administration: { version: 1, targets: { [table]: { person: 'person' } },
    memberships: { table: 'reviewrace.membership', person: 'person', dimensions: { store: ['store'] } },
    approvals: [{ id: 'phone', table, operation: 'update', columns: ['phone'], outcome: 'approval', approverRole: 'Race Reviewer' }] },
    tables: [{ name: table, id_pattern: 'prompt', columns: [
      { column_name: 'person', column_type: 'Reference', reference_table: 'Person' }, { column_name: 'phone', column_type: 'Data' },
    ] }, { name: 'reviewrace.membership', id_pattern: 'prompt', columns: [
      { column_name: 'person', column_type: 'Reference', reference_table: 'Person' }, { column_name: 'store', column_type: 'Data' },
    ] }], roles: ['Race Maker', 'Race Reviewer'], permissions: [
      { table, role: 'Race Maker', operations: { read: ['phone'], update: ['phone'] } },
      { table, role: 'Race Reviewer', operations: { approve: ['phone'] } },
    ],
  })
  await installApp('reviewrace')
  await provisionApp('reviewrace', async () => {
    await saveDoc(table, { row_id: 'contact', person: maker.row_id, phone: 'original' })
    await saveDoc('reviewrace.membership', { row_id: 'membership', person: maker.row_id, store: 'A' })
  })
  const scope = await saveSystemRow('Scope', { app: 'reviewrace', mode: 'named', tuples: [{ store: 'A' }] }, 'bootstrap')
  for (const [person, role] of [[maker.row_id, 'Race Maker'], [reviewer.row_id, 'Race Reviewer']])
    await saveSystemRow('Role Assignment', { app: 'reviewrace', person, role, scope: scope.row_id }, 'bootstrap')
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  try {
    const post = async (token: string, path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const [current] = await sql`select updated_at from reviewrace.contact where row_id = 'contact'`
    const makerSession = await issueSession(String(maker.row_id))
    const held = await post(makerSession.token, '/api/save_row', { table,
      row: { row_id: 'contact', updated_at: current.updated_at, phone: 'reviewed' } })
    expect(held.status).toBe(202)
    const proposal = await held.json() as { proposal: string; version: number }
    const reviewerSession = await issueSession(String(reviewer.row_id))
    const decide = () => post(reviewerSession.token, '/api/administration/review', {
      proposal: proposal.proposal, version: proposal.version, decision: 'approve',
    })
    const responses = await Promise.all([decide(), decide()])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect(await sql`select phone from reviewrace.contact where row_id = 'contact'`).toEqual([{ phone: 'reviewed' }])
    const history = await sql`select data from featherbase.version where ref_table = ${table} and ref_name = 'contact'`
    expect(history).toHaveLength(1)
    expect(history[0].data).toMatchObject({ approval: { proposal: proposal.proposal, maker: maker.row_id, reviewers: [reviewer.row_id] } })
    expect(await sql`select decision from featherbase.decision where proposal = ${proposal.proposal}`).toEqual([{ decision: 'approve' }])
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await sql`delete from featherbase.decision where proposal in (select row_id from featherbase.proposal where app = 'reviewrace')`
    await sql`delete from featherbase.proposal_change where proposal in (select row_id from featherbase.proposal where app = 'reviewrace')`
    await sql`delete from featherbase.proposal where app = 'reviewrace'`
    await sql`delete from featherbase.role_assignment where app = 'reviewrace'`
    await sql`delete from featherbase.scope where row_id = ${String(scope.row_id)}`
    await sql`delete from featherbase.version where ref_table = ${table}`
    await uninstallApp('reviewrace')
    await deleteDoc('Person', String(reviewer.row_id), 'Administrator')
    await deleteDoc('Person', String(maker.row_id), 'Administrator')
  }
}, 30_000)
