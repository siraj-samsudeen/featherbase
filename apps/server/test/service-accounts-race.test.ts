// Not sandboxed: two requests must race on COMMITTED rows through separate
// pool connections to prove the unique index decides. Every row this file
// writes carries a unique label and is removed in finally.
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { sql } from '../src/db'
import { createServiceAccount } from '../src/service-accounts'

it('two service accounts created with one name at once: one is made, the other is told the name is taken', async () => {
  const label = `race-bot-${randomUUID().slice(0, 8)}`
  try {
    const results = await Promise.allSettled([createServiceAccount(label, [], 'Administrator'), createServiceAccount(label, [], 'Administrator')])
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(refused.reason).toMatchObject({ type: 'ConflictError', message: expect.stringContaining(`A service account named "${label}" already exists`) })
    expect(await sql`select 1 from service_account where label = ${label}`).toHaveLength(1)
  } finally {
    const ids = (await sql`select row_id from service_account where label = ${label}`).map((r) => String(r.row_id))
    for (const id of ids) {
      await sql`delete from has_role where parent = ${id}`
      await sql`delete from activity_log where operation like ${'%' + id + '%'}`
      await sql`delete from service_account where row_id = ${id}`
    }
  }
}, 30_000)

it('a database failure while creating a service account is raised as it is, and nothing is kept', async () => {
  const label = `fail-bot-${randomUUID().slice(0, 8)}`
  // A NUL byte cannot be stored in text, so the insert fails with no unique violation to translate.
  await expect(createServiceAccount(label, [], 'bad\u0000actor')).rejects.toMatchObject({ code: '22021' })
  expect(await sql`select 1 from service_account where label = ${label}`).toHaveLength(0)
}, 30_000)
