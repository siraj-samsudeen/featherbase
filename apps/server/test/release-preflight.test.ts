// The person release cannot half-apply (review A-M1): the refusals that do not
// need the data run before the first migration, and 0101, 0101a and 0102 run
// as one transaction.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { config } from '../src/config'
import { migrationBatches } from '../src/migrate'
import { preflightRelease } from '../src/release-preflight'

afterEach(() => vi.unstubAllEnvs())

describe('migration batches', () => {
  it('the person migrations share one transaction; every other file stands alone', () => {
    expect(migrationBatches(['0099_delegated_login_settings.ts', '0100_person_identities.ts', '0101_person_rename.ts', '0101a_service_account_name_unique.sql', '0102_person_resolution.ts', '0103_later.sql']))
      .toEqual([
        ['0099_delegated_login_settings.ts'],
        ['0100_person_identities.ts'],
        ['0101_person_rename.ts', '0101a_service_account_name_unique.sql', '0102_person_resolution.ts'],
        ['0103_later.sql'],
      ])
    // A database that already ran 0101 converges with the rest of the group.
    expect(migrationBatches(['0101a_service_account_name_unique.sql', '0102_person_resolution.ts'])).toEqual([
      ['0101a_service_account_name_unique.sql', '0102_person_resolution.ts'],
    ])
  })
})

describe('release preflight', () => {
  test('test mode on a production server refuses', async () => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    vi.stubEnv('DISABLE_DATABASE_ENVIRONMENT_CHECK', '1')
    await expect(preflightRelease({ environment: 'production' })).rejects.toThrow(/DELEGATED_LOGIN_TEST_MODE is set on a "production" server/)
  })

  test('test mode against a database labelled production refuses, even for a staging process', async () => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    vi.stubEnv('DISABLE_DATABASE_ENVIRONMENT_CHECK', '1')
    await sql`update internal_metadata set value = 'production' where key = 'environment'`
    await expect(preflightRelease({ environment: 'staging' })).rejects.toThrow(/this database is labelled "production"/)
  })

  test('where test mode is allowed, every check passes and says so', async () => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    const lines = await preflightRelease({ environment: 'test' })
    expect(lines).toContain('test mode on, allowed here')
    expect(lines.some((l) => l.startsWith('pending migrations:'))).toBe(true)
  })
})

// End to end: the real release command against a fresh database labelled
// production, with test mode set. It must stop before creating anything.
const server = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tsx = resolve(server, 'node_modules/tsx/dist/cli.mjs')
const admin = postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
const created: string[] = []
afterAll(async () => {
  for (const name of created) await admin.unsafe(`drop database "${name}" with (force)`)
  await admin.end()
})

it('a production-labelled database with test mode set refuses BEFORE migrating', async () => {
  const name = `featherbase_preflight_${randomUUID().replaceAll('-', '')}`
  await admin.unsafe(`create database "${name}"`)
  created.push(name)
  const url = new URL(config.databaseUrl)
  url.pathname = `/${name}`
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} })
  try {
    await db.unsafe(`create schema featherbase;
      create table featherbase.internal_metadata (key text primary key, value text not null, updated_at timestamptz not null default now());
      insert into featherbase.internal_metadata (key, value) values ('environment', 'production')`)
    let output = ''
    let failed = false
    try {
      execFileSync(process.execPath, [tsx, 'src/release.ts'], {
        cwd: server, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DATABASE_URL: url.toString(), FEATHERBASE_ENV: 'production', NODE_ENV: 'production', ADMIN_PASSWORD: '', DELEGATED_LOGIN_TEST_MODE: 'trust-any-password' },
      })
    } catch (error) {
      failed = true
      const e = error as { stdout?: string; stderr?: string }
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    expect(failed).toBe(true)
    expect(output).toMatch(/release failed — aborting: DELEGATED_LOGIN_TEST_MODE is set on a "production" server/)
    expect(output).not.toMatch(/applied 0001/)
    const [ledger] = await db`select to_regclass('featherbase.migration') as m, to_regclass('public.migration') as p`
    expect(ledger).toEqual({ m: null, p: null })
  } finally {
    await db.end()
  }
}, 90_000)
