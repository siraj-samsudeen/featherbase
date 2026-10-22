// Not sandboxed: two requests must race on COMMITTED rows through separate
// pool connections to prove the database decides (person-identities, review
// B-M3). Every row this file writes carries a unique prefix and is removed in
// finally.
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { sql } from '../src/db'
import { methodOfKind, unlinkIdentity } from '../src/identities'
import { resolveVerified } from '../src/sign-in'

async function cleanup(prefix: string) {
  await sql`delete from sign_in_identity where person_id like ${prefix + '%'}`
  await sql`delete from activity_log where "user" like ${prefix + '%'}`
  await sql`delete from person where row_id like ${prefix + '%'}`
}

async function person(row_id: string, email: string | null = null) {
  await sql`insert into person ${sql({ row_id, email, full_name: row_id, enabled: true, created_by: 'Administrator', updated_by: 'Administrator' })}`
}

it('two first sign-ins racing for one invite: one link, both signed in as that person', async () => {
  const p = `psn_conc${randomUUID().slice(0, 8)}` // person-rename: ids live in the psn_ namespace
  try {
    const address = `${p}@jeyarama.com`
    await person(p, address)
    await sql`insert into sign_in_identity ${sql({ id: `uid_${p}`, person_id: p, method: 'google', pending_email: address, linked_by: 'test' })}`
    const google = (await methodOfKind('google'))!
    const v = { status: 'verified' as const, subject: `g-${p}`, email: address, email_verified: true }
    const results = await Promise.allSettled([resolveVerified(google, v), resolveVerified(google, v), resolveVerified(google, v)])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
    expect(results.map((r) => (r as PromiseFulfilledResult<{ user: string }>).value.user)).toEqual([p, p, p])
    expect(await sql`select subject from sign_in_identity where person_id = ${p}`).toEqual([{ subject: `g-${p}` }])
  } finally {
    await cleanup(p)
  }
}, 30_000)

it('two different Google accounts racing for one invite: exactly one claims it', async () => {
  const p = `psn_conc${randomUUID().slice(0, 8)}` // person-rename: ids live in the psn_ namespace
  try {
    const address = `${p}@jeyarama.com`
    await person(p, address)
    await sql`insert into sign_in_identity ${sql({ id: `uid_${p}`, person_id: p, method: 'google', pending_email: address, linked_by: 'test' })}`
    const google = (await methodOfKind('google'))!
    const attempt = (subject: string) => resolveVerified(google, { status: 'verified', subject, email: address, email_verified: true })
    const results = await Promise.allSettled([attempt(`g-a-${p}`), attempt(`g-b-${p}`)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await sql`select 1 from sign_in_identity where person_id = ${p} and subject is not null`).toHaveLength(1)
  } finally {
    await cleanup(p)
  }
}, 30_000)

it('two concurrent removals of a person\'s last two ways in: one is refused', async () => {
  const p = `psn_conc${randomUUID().slice(0, 8)}` // person-rename: ids live in the psn_ namespace
  const prev = process.env.ALLOW_MOCK_OAUTH
  process.env.ALLOW_MOCK_OAUTH = '1' // Google counts as a way in
  try {
    await person(p)
    await sql`insert into sign_in_identity ${sql({ id: `uid_${p}_1`, person_id: p, method: 'google', subject: `g1-${p}`, linked_by: 'test' })}`
    await sql`insert into sign_in_identity ${sql({ id: `uid_${p}_2`, person_id: p, method: 'google', subject: `g2-${p}`, linked_by: 'test' })}`
    const results = await Promise.allSettled([
      unlinkIdentity(`uid_${p}_1`, p, { self: p }),
      unlinkIdentity(`uid_${p}_2`, p, { self: p }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(refused.reason).toMatchObject({ type: 'ConflictError' })
    expect(await sql`select 1 from sign_in_identity where person_id = ${p}`).toHaveLength(1)
  } finally {
    if (prev === undefined) delete process.env.ALLOW_MOCK_OAUTH
    else process.env.ALLOW_MOCK_OAUTH = prev
    await cleanup(p)
  }
}, 30_000)
