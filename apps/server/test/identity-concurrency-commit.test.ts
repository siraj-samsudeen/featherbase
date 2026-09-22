import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { sql, withTransaction } from '../src/db'
import { saveDoc } from '../src/document'
import { issueExternalSession, login, resolveToken, setUserPassword } from '../src/auth'
import { beginIdentityLink, completeHostedOperation } from '../src/login-operations'
import { issuer } from './oidc-issuer'
import { app } from '../src/index'

// Real commits on independent connections, never the transaction sandbox.
// AUTH_IDENTITY_COMMIT_PROOF=1 DATABASE_URL=..._identity_commit_e2e
void app
const prove = process.env.AUTH_IDENTITY_COMMIT_PROOF === '1' ? test : test.skip

// @spec login_sessions_are_revocable_on_every_use
// @spec identity_linking_requires_two_bound_proofs.concurrent_subject_claims_never_reassign_ownership
prove('independent commits serialize both orders of disable/issuance and concurrent subject claims', async () => {
  const [database] = await sql`select current_database() as name,
    (select value from internal_metadata where key = 'environment') as environment`
  expect(String(database.name).endsWith('_identity_commit_e2e')).toBe(true)
  expect(database.environment).toBe('test')
  const prefix = randomUUID()
  const provider = `${prefix}-provider`
  await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
    values (${provider}, 'google', 'https://accounts.google.com', ${prefix}, true)`
  for (const first of ['disable', 'issue'] as const) {
    const user = `${prefix}-${first}`
    await saveDoc('User', { row_id: user, full_name: `Concurrency ${first}` })
    await sql`insert into external_identity (id, user_id, provider_id, issuer, subject)
      values (${user}, ${user}, ${provider}, 'https://accounts.google.com', ${user})`
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let entered = false
    const issue = () => issueExternalSession(provider, 'https://accounts.google.com', user, null, new Date())
    const disable = () => sql`update "user" set enabled = false where row_id = ${user}`
    const leading = withTransaction(async () => {
      const session = first === 'issue' ? await issue() : (await disable(), null)
      entered = true
      await gate
      return session
    })
    let trailing: Promise<unknown> | undefined
    try {
      await expect.poll(() => entered).toBe(true)
      trailing = Promise.resolve(first === 'issue' ? disable() : issue())
        .then(value => ({ ok: true, value }), error => ({ ok: false, type: error.type }))
      await expect.poll(async () => Number((await sql`select count(*) as count from pg_stat_activity
        where datname = current_database() and wait_event = 'transactionid'`)[0].count)).toBeGreaterThan(0)
      release()
      const session = await leading
      expect(await trailing).toMatchObject({ ok: first === 'issue', ...(first === 'disable' ? { type: 'AuthenticationError' } : {}) })
      if (session) await expect(resolveToken(`Bearer ${session.token}`)).rejects.toMatchObject({ type: 'AuthenticationError' })
      else expect(await sql`select id from login_session where user_id = ${user}`).toEqual([])
      await sql`update "user" set enabled = true where row_id = ${user}`
      if (session) await expect(resolveToken(`Bearer ${session.token}`)).rejects.toMatchObject({ type: 'AuthenticationError' })
    } finally {
      release()
      await Promise.allSettled([leading, trailing])
    }
  }

  const upstream = await issuer()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let locked = false
  let blocker: Promise<unknown> | undefined
  const callbacks: Promise<{ ok: boolean; type?: string }>[] = []
  try {
    const linkProvider = `${prefix}-link`
    upstream.setClaims({ aud: linkProvider })
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values (${linkProvider}, 'google', 'https://accounts.google.com', ${linkProvider}, true)`
    const attempts = []
    for (const suffix of ['one', 'two']) {
      const user = `${prefix}-${suffix}`
      await saveDoc('User', { row_id: user, full_name: `Claimant ${suffix}` })
      await setUserPassword(user, 'synthetic-concurrency-password')
      const session = await login(user, 'synthetic-concurrency-password')
      const operation = await beginIdentityLink(`Bearer ${session.token}`, linkProvider, 'http://localhost/callback')
      attempts.push({ session, operation })
    }
    blocker = withTransaction(async () => {
      await sql`select id from login_provider where id = ${linkProvider} for update`
      locked = true
      await gate
    })
    await expect.poll(() => locked).toBe(true)
    for (const { session, operation } of attempts) {
      const callback = new URL(`http://localhost/callback?state=${operation.state}&code=${upstream.code(operation.authorizationUrl)}`)
      callbacks.push(completeHostedOperation(callback, operation.browserSecret, session.token)
        .then(() => ({ ok: true }), error => ({ ok: false, type: error.type })))
    }
    await expect.poll(async () => Number((await sql`select count(*) as count from pg_stat_activity
      where datname = current_database() and wait_event in ('transactionid', 'tuple')`)[0].count)).toBeGreaterThanOrEqual(2)
    release()
    await blocker
    const results = await Promise.all(callbacks)
    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => !result.ok)).toEqual([{ ok: false, type: 'ConflictError' }])
    const owners = await sql`select user_id from external_identity where provider_id = ${linkProvider} and subject = 'subject-one'`
    expect(owners).toHaveLength(1)
    expect(attempts.map(attempt => attempt.session.user.row_id)).toContain(owners[0].user_id)
    expect((await sql`select count(*)::int as count from login_session where method = 'external'
      and user_id in ${sql(attempts.map(attempt => attempt.session.user.row_id))}`)[0].count).toBe(1)
  } finally {
    release()
    await Promise.allSettled([blocker, ...callbacks])
    await upstream.close()
  }
}, 60_000)
