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
    for (const cause of ['assignment', 'membership']) {
      let release!: () => void
      let locked!: () => void
      const ready = new Promise<void>(resolve => { locked = resolve })
      const gate = new Promise<void>(resolve => { release = resolve })
      const holder = withTransaction(async () => {
        if (cause === 'assignment') await sql`update featherbase.role_assignment set ends_on = '2000-01-01'
          where row_id = ${String(assignment.row_id)}`
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
