import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { config } from '../src/config'
import {
  ENVIRONMENT_KEY,
  assertDatabaseEnvironment,
  stampEnvironment,
  storedEnvironment,
} from '../src/db-environment'
import { pendingMigrations } from '../src/migrate'

// The guard that turns "thirteen unrelated test failures" into one sentence
// naming the database. Every test here runs inside the sandbox transaction,
// so the stamps it writes roll back and the real stamp is never disturbed.

describe('the database records which environment it belongs to', () => {
  test('the suite runs against a database stamped test', async () => {
    // Not a tautology: this is the assertion that would have caught the real
    // incident, where a test run silently used the development database.
    expect(await storedEnvironment()).toBe('test')
  })

  test('a matching environment passes', async () => {
    await expect(assertDatabaseEnvironment('test')).resolves.toBeUndefined()
  })

  test('a mismatch is refused, and the message names BOTH environments', async () => {
    await stampEnvironment('development')
    await expect(assertDatabaseEnvironment('test')).rejects.toThrow(
      /belongs to the 'development' environment.*is 'test'/s,
    )
  })

  test('the refusal names the database but never the password', async () => {
    await stampEnvironment('production')
    const err = await assertDatabaseEnvironment('test').catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    const message = (err as Error).message
    // Enough to identify the target: scheme, host and database name.
    const url = new URL(config.databaseUrl)
    expect(message).toContain(`Connected to: ${url.protocol}//${url.host}${url.pathname}`)

    // ...and never the credential, since this text is what gets pasted into
    // an issue when someone asks why their run refused to start.
    //
    // Asserting "the message does not contain the password" would be wrong:
    // the default credentials are literally `postgres`, which is also the URL
    // SCHEME, so such an assertion can never pass however well the redaction
    // works. The precise property is that the credential SECTION is gone —
    // and since that section always terminates in '@', its absence proves no
    // user or password was printed, for any credential value.
    expect(message).not.toContain('@')
  })

  test('an unstamped database is nobody‘s yet, so it passes', async () => {
    await sql`delete from internal_metadata where key = ${ENVIRONMENT_KEY}`
    expect(await storedEnvironment()).toBeNull()
    // A brand-new database must not be refused — the migrator is about to
    // claim it. Refusing here would make bootstrapping impossible.
    await expect(assertDatabaseEnvironment('test')).resolves.toBeUndefined()
  })

  test('the override lets an operator proceed deliberately', async () => {
    await stampEnvironment('development')
    process.env.DISABLE_DATABASE_ENVIRONMENT_CHECK = '1'
    try {
      await expect(assertDatabaseEnvironment('test')).resolves.toBeUndefined()
    } finally {
      delete process.env.DISABLE_DATABASE_ENVIRONMENT_CHECK
    }
  })
})

describe('pending migrations are reported before they can confuse a run', () => {
  test('a fully migrated database reports nothing pending', async () => {
    expect(await pendingMigrations()).toEqual([])
  })

  test('a migration missing from the record shows up as pending', async () => {
    // Forget one, exactly as an interrupted or hand-edited run would.
    const [victim] = await sql`select name from migration order by name desc limit 1`
    await sql`delete from migration where name = ${victim.name}`
    expect(await pendingMigrations()).toEqual([String(victim.name)])
  })
})
