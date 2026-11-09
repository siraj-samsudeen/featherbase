// A sign-in, a self-link and an administrator's link each check before they
// write; another transaction may commit the same subject, or remove the
// person, in between. Not sandboxed: a second connection holds that other
// transaction open, so the database's own locks decide the order.
import postgres from 'postgres'
import { expect } from 'vitest'
import { committedTest } from './pg-test-shared'
import { sql } from '../src/db'
import { config } from '../src/config'
import { getSignInMethod, linkIdentity } from '../src/identities'
import { linkVerifiedToSelf, resolveVerified } from '../src/sign-in'
import { configureDelegated, configureGoogle, inviteGoogleRaw } from './identity-fixtures'
import { makePerson } from './fixtures'

/** Run `statements` in a transaction on another connection, left open until
 *  the returned commit is called. */
async function openTransaction(statements: (tx: postgres.ReservedSql) => Promise<unknown>) {
  const other = postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
  const tx = await other.reserve()
  await tx`begin`
  await statements(tx)
  return async () => {
    await tx`commit`
    tx.release()
    await other.end({ timeout: 5 })
  }
}

/** Resolves once some connection waits on a row or index lock. */
async function someoneWaits() {
  for (;;) {
    const [row] = await sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`
    if (row.n > 0) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const verified = (subject: string, email: string) =>
  ({ status: 'verified' as const, subject, email, email_verified: true, display_name: null, hosted_domain: null })

committedTest('a self-link that loses its subject to another person\'s commit is refused as taken', async () => {
  await configureGoogle({ allowed_email_domains: '' })
  const winner = await makePerson({})
  const loser = await makePerson({})
  const commit = await openTransaction((tx) => tx`insert into featherbase.sign_in_identity (id, person_id, method, subject, linked_by)
    values ('uid_race_winner', ${winner}, 'google', 'g-race', 'test')`)
  const google = (await getSignInMethod('google'))!
  const linking = linkVerifiedToSelf(google, loser, verified('g-race', 'race@gmail.com')).then(() => null, (error: unknown) => error)
  await someoneWaits()
  await commit()
  expect(await linking).toMatchObject({ type: 'ConflictError', message: 'This account is already linked to another person' })
})

committedTest('a first sign-in claiming an invite that loses its subject to another commit signs in as the winner', async () => {
  await configureGoogle({ allowed_email_domains: '' })
  const winner = await makePerson({})
  const invited = await makePerson({})
  await inviteGoogleRaw(invited, 'invited.race@gmail.com')
  const commit = await openTransaction((tx) => tx`insert into featherbase.sign_in_identity (id, person_id, method, subject, linked_by)
    values ('uid_claim_winner', ${winner}, 'google', 'g-claim', 'test')`)
  const google = (await getSignInMethod('google'))!
  const resolving = resolveVerified(google, verified('g-claim', 'invited.race@gmail.com'))
  await someoneWaits()
  await commit()
  expect(await resolving).toMatchObject({ user: winner, identity: 'uid_claim_winner' })
})

committedTest('a link for a person removed by another commit meanwhile is refused as unknown', async () => {
  await configureDelegated()
  const gone = await makePerson({})
  const commit = await openTransaction((tx) => tx`delete from featherbase.person where row_id = ${gone}`)
  const linking = linkIdentity(gone, { method: 'stylehr', subject: 'RACE-1' }, 'Administrator').then(() => null, (error: unknown) => error)
  await someoneWaits()
  await commit()
  expect(await linking).toMatchObject({ type: 'ValidationError', message: 'Unknown sign-in method or person' })
})
