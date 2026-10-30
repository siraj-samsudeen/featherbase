// Not sandboxed: two requests must race on COMMITTED rows through separate
// pool connections to prove the database decides (person-identities, review
// B-M3). Every row this file writes carries a unique prefix and is removed in
// finally.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { expect, it } from 'vitest'
import { sql } from '../src/db'
import { WAYS_IN_LOCK_KEY, methodOfKind, removeOwnPassword, unlinkIdentity, updateIdentity } from '../src/identities'
import { saveDoc } from '../src/document'
import { loadControllers } from '../src/controllers'
import { saveImportedRow } from '../src/import-corrections'
import { getMeta } from '../src/meta'
import { resolveVerified } from '../src/sign-in'

async function cleanup(prefix: string) {
  await sql`delete from has_role where parent like ${prefix + '%'}`
  await sql`delete from sign_in_identity where person_id like ${prefix + '%'}`
  await sql`delete from activity_log where "user" like ${prefix + '%'}`
  await sql`delete from person_identifier where person_id like ${prefix + '%'}`
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
    // Unlinking ends a link rather than deleting it (person-resolution D5):
    // exactly one is still live.
    expect(await sql`select 1 from sign_in_identity where person_id = ${p} and ended_at is null`).toHaveLength(1)
  } finally {
    if (prev === undefined) delete process.env.ALLOW_MOCK_OAUTH
    else process.env.ALLOW_MOCK_OAUTH = prev
    await cleanup(p)
  }
}, 30_000)

it('two first sign-ins by one new Google account: the loser signs in as the winner and no second person stays', async () => {
  const tag = randomUUID().slice(0, 8)
  const addresses = [`psnconc${tag}a@store.example`, `psnconc${tag}b@store.example`]
  const subject = `g-new-${tag}`
  try {
    const google = { ...(await methodOfKind('google'))!, new_person: 'create' as const, allowed_email_domains: '*' }
    // The same account arriving twice at once, each time with a different address
    // on it, so only the subject's unique index can tell them apart.
    const attempt = (email: string) => resolveVerified(google, { status: 'verified', subject, email, email_verified: true, hosted_domain: 'jeyarama.com' })
    const results = await Promise.allSettled(addresses.map(attempt))
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    const users = results.map((r) => (r as PromiseFulfilledResult<{ user: string }>).value.user)
    expect(users[0]).toBe(users[1])
    expect(await sql`select 1 from sign_in_identity where subject = ${subject}`).toHaveLength(1)
    expect(await sql`select 1 from person where email in ${sql(addresses)}`).toHaveLength(1)
  } finally {
    const people = (await sql`select row_id from person where email in ${sql(addresses)}`).map((r) => String(r.row_id))
    for (const p of people) {
      await sql`delete from sign_in_identity where person_id = ${p}`
      await sql`delete from activity_log where "user" = ${p}`
      await sql`delete from has_role where parent = ${p}`
      await sql`delete from person_identifier where person_id = ${p}`
      await sql`delete from person where row_id = ${p}`
    }
  }
}, 30_000)

it('one Google account claiming two people\'s expected sign-ins at once: the loser signs in as the winner', async () => {
  const tag = randomUUID().slice(0, 8)
  const people = [`psn_conc${tag}a`, `psn_conc${tag}b`]
  const addresses = people.map((p) => `${p}@jeyarama.com`)
  const subject = `g-exp-${tag}`
  try {
    for (const [i, p] of people.entries()) {
      await person(p, addresses[i])
      await sql`update person set expects_google_sign_in = true where row_id = ${p}`
    }
    const google = { ...(await methodOfKind('google'))!, allowed_email_domains: '*' }
    const attempt = (email: string) => resolveVerified(google, { status: 'verified', subject, email, email_verified: true, hosted_domain: 'jeyarama.com' })
    const results = await Promise.allSettled(addresses.map(attempt))
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    const users = results.map((r) => (r as PromiseFulfilledResult<{ user: string }>).value.user)
    expect(users[0]).toBe(users[1])
    expect(await sql`select 1 from sign_in_identity where subject = ${subject}`).toHaveLength(1)
  } finally {
    for (const p of people) await cleanup(p)
  }
}, 30_000)

it('a database failure while linking an expected sign-in is not hidden: it is raised and nothing is kept', async () => {
  const p = `psn_conc${randomUUID().slice(0, 8)}`
  try {
    const address = `${p}@jeyarama.com`
    await person(p, address)
    await sql`update person set expects_google_sign_in = true where row_id = ${p}`
    const google = { ...(await methodOfKind('google'))!, allowed_email_domains: '*' }
    // A NUL byte cannot be stored in text: the insert fails, with no unique violation to recover from.
    await expect(
      resolveVerified(google, { status: 'verified', subject: `g-nul-${p}`, email: address, email_verified: true, hosted_domain: 'jeyarama.com', display_name: 'bad\u0000name' }),
    ).rejects.toMatchObject({ code: '22021' })
    expect(await sql`select 1 from sign_in_identity where person_id = ${p}`).toHaveLength(0)
    expect(await sql`select 1 from person where row_id = ${p} and expects_google_sign_in`).toHaveLength(1)
  } finally {
    await cleanup(p)
  }
}, 30_000)

it('a database failure while creating a first-time person is raised, and no person is left behind', async () => {
  const tag = randomUUID().slice(0, 8)
  const address = `psnconc${tag}@jeyarama.com`
  try {
    const google = { ...(await methodOfKind('google'))!, new_person: 'create' as const, allowed_email_domains: '*' }
    await expect(
      resolveVerified(google, { status: 'verified', subject: `g-nul-${tag}`, email: address, email_verified: true, hosted_domain: 'jeyarama.com', display_name: 'bad\u0000name' }),
    ).rejects.toBeInstanceOf(Error)
    expect(await sql`select 1 from person where email = ${address}`).toHaveLength(0)
    expect(await sql`select 1 from sign_in_identity where subject = ${'g-nul-' + tag}`).toHaveLength(0)
  } finally {
    await sql`delete from person where email = ${address}`
  }
}, 30_000)

// #693, Codex review round 3: narrowing the domain list counts the password,
// and removing the password counts Google under the old list. Without one
// shared lock both could pass and commit, leaving no way in.
it('narrowing the domain list racing a System Manager removing their password: exactly one is refused', async () => {
  const p = `psn_conc${randomUUID().slice(0, 8)}`
  const prev = process.env.ALLOW_MOCK_OAUTH
  process.env.ALLOW_MOCK_OAUTH = '1' // Google counts as a way in
  // The Sign In Method controller (its lockout guard) runs on saveDoc only once loaded.
  await loadControllers()
  const [before] = await sql`select allowed_email_domains from sign_in_method where row_id = 'google'`
  try {
    await sql`update sign_in_method set allowed_email_domains = 'example.com,sister.test' where row_id = 'google'`
    await person(p)
    await sql`update person set password_hash = 'x' where row_id = ${p}`
    await sql`insert into has_role ${sql({ row_id: `hr_${p}`, parent: p, parenttype: 'Person', parentfield: 'roles', role: 'System Manager' })}`
    await sql`insert into sign_in_identity ${sql({ id: `uid_${p}`, person_id: p, method: 'google', subject: `g-${p}`, email: `${p}@sister.test`, linked_by: 'self', hosted_domain: 'sister.test' })}`
    const [g] = await sql`select updated_at from sign_in_method where row_id = 'google'`
    // Force the overlap: a third connection holds the tables both changes
    // write only AFTER their checks, so without the shared lock both checks
    // run against the state before either commits.
    const gate = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
    const held = gate.begin(async (t) => {
      await t`lock table featherbase.activity_log, featherbase.version in exclusive mode`
      await new Promise((r) => setTimeout(r, 1500))
    })
    await new Promise((r) => setTimeout(r, 200))
    const racing = Promise.allSettled([
      saveDoc('Sign In Method', { row_id: 'google', allowed_email_domains: 'example.com', updated_at: g.updated_at }, 'Administrator'),
      removeOwnPassword(p),
    ])
    await held
    await gate.end()
    const results = await racing
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const [after] = await sql`select password_hash is not null as has_password from person where row_id = ${p}`
    const [domains] = await sql`select allowed_email_domains from sign_in_method where row_id = 'google'`
    // Either the list kept sister.test or the password stayed: never neither.
    expect(after.has_password || domains.allowed_email_domains === 'example.com,sister.test').toBe(true)
    expect(after.has_password && domains.allowed_email_domains === 'example.com,sister.test').toBe(false)
  } finally {
    await sql`update sign_in_method set allowed_email_domains = ${before.allowed_email_domains} where row_id = 'google'`
    if (prev === undefined) delete process.env.ALLOW_MOCK_OAUTH
    else process.env.ALLOW_MOCK_OAUTH = prev
    await cleanup(p)
  }
}, 30_000)

// #693, Codex review round 7: a Sign In Method edit must take the ways-in lock
// BEFORE it locks its row. An identity move takes that lock and then inserts
// a link whose foreign key waits on the method row; in the other order the
// two deadlock. A third connection holds the lock so the move queues for it
// first and the edit second, the interleaving that deadlocked.
it('an identity move racing a Sign In Method edit: both complete, neither deadlocks', async () => {
  const p = `psn_conc${randomUUID().slice(0, 8)}`
  const q = `${p}b`
  await loadControllers()
  const [before] = await sql`select label from sign_in_method where row_id = 'google'`
  try {
    await person(p)
    await person(q)
    await sql`insert into sign_in_identity ${sql({ id: `uid_${p}`, person_id: p, method: 'google', subject: `g-${p}`, email: `${p}@example.com`, linked_by: 'test' })}`
    const gate = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
    let release: () => void = () => {}
    const holding = new Promise<void>((r) => (release = r))
    const held = gate.begin(async (t) => {
      await t`select pg_advisory_xact_lock(${WAYS_IN_LOCK_KEY}::bigint)`
      await holding
    })
    await new Promise((r) => setTimeout(r, 200))
    const move = updateIdentity(`uid_${p}`, { person_id: q }, 'Administrator')
    await new Promise((r) => setTimeout(r, 300))
    const [g] = await sql`select updated_at from sign_in_method where row_id = 'google'`
    const edit = saveDoc('Sign In Method', { row_id: 'google', label: `Google ${p}`, updated_at: g.updated_at }, 'Administrator')
    await new Promise((r) => setTimeout(r, 300))
    release()
    await held
    await gate.end()
    const results = await Promise.allSettled([move, edit])
    const errors = results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason)
    expect(errors.map((e) => (e as { code?: string }).code)).not.toContain('40P01')
    expect(errors).toEqual([])
    expect(await sql`select person_id from sign_in_identity where subject = ${`g-${p}`} and ended_at is null`).toEqual([{ person_id: q }])
  } finally {
    await sql`update sign_in_method set label = ${before.label} where row_id = 'google'`
    await cleanup(p)
  }
}, 30_000)

// #693, Codex review round 9: an import update locks its target row and then
// saves it, so it must take the pre-row locks (the Sign In Method ways-in
// lock) first, as saveDoc does. The gate lets a direct edit queue for the
// ways-in lock first and the import second: in the old order the import held
// the row while it queued, and the edit then waited on that row.
it('an import update of a Sign In Method racing a direct edit: neither deadlocks', async () => {
  const tag = randomUUID().slice(0, 8)
  await loadControllers()
  const [before] = await sql`select label, self_link from sign_in_method where row_id = 'google'`
  try {
    const meta = await getMeta('Sign In Method')
    const gate = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
    let release: () => void = () => {}
    const holding = new Promise<void>((r) => (release = r))
    const held = gate.begin(async (t) => {
      await t`select pg_advisory_xact_lock(${WAYS_IN_LOCK_KEY}::bigint)`
      await holding
    })
    await new Promise((r) => setTimeout(r, 200))
    const [g] = await sql`select updated_at from sign_in_method where row_id = 'google'`
    const edit = saveDoc('Sign In Method', { row_id: 'google', self_link: !before.self_link, updated_at: g.updated_at }, 'Administrator')
    await new Promise((r) => setTimeout(r, 300))
    const imported = saveImportedRow(meta, { row_id: 'google', label: `Google ${tag}`, updated_at: g.updated_at }, 'Administrator', `run-${tag}`, true)
    await new Promise((r) => setTimeout(r, 300))
    release()
    await held
    await gate.end()
    const results = await Promise.allSettled([edit, imported])
    const codes = results.filter((r) => r.status === 'rejected').map((r) => ((r as PromiseRejectedResult).reason as { code?: string }).code)
    expect(codes).not.toContain('40P01')
    // A stale updated_at may refuse one of them; neither dies in a deadlock.
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true)
  } finally {
    await sql`update sign_in_method set label = ${before.label}, self_link = ${before.self_link} where row_id = 'google'`
    await sql`delete from featherbase.import_source where run_id = ${`run-${tag}`}`
  }
}, 30_000)
