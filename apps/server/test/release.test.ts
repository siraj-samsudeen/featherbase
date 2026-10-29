// The release step (`tsx src/release.ts`) run in this process through
// `main(argv, io)` (ADR 0012), inside a rolled-back sandbox on the migrated
// test database. Releases against fresh and production-labelled databases,
// and two releases at once, run as processes in release-preflight.test.ts,
// which also proves the entry point.
import { afterEach, describe, expect, vi } from 'vitest'
import { sql } from '../src/db'
import { main } from '../src/release'
import { runMain } from './command-io'
import { test } from './pg-test'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('release', () => {
  test('on an up-to-date database it applies nothing and reports the preflight and the health checks', async () => {
    const r = await runMain(main, [])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/^preflight: /)
    expect(r.stdout).toContain('preflight: pending migrations: none\n')
    expect(r.stdout).toMatch(/\nhealth: passing /)
  })

  test('applies a migration not yet recorded', async () => {
    await sql`delete from migration where name = '0143_drop_patch_log.sql'`
    await sql.unsafe('create table featherbase.patch_log (patch text primary key)')
    const r = await runMain(main, [])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('preflight: pending migrations: 0143_drop_patch_log.sql\n')
    expect(await sql`select 1 from migration where name = '0143_drop_patch_log.sql'`).toHaveLength(1)
    expect(await sql`select to_regclass('featherbase.patch_log') as r`).toEqual([{ r: null }])
  })

  test('a failing health check is a warning on stderr, and the release still succeeds', async () => {
    // An enabled scheduled job whose last run failed fails its health check.
    await sql`update scheduled_job set enabled = true, last_outcome = 'error', last_run_at = now() where method = 'check_sla'`
    const r = await runMain(main, [])
    expect(r.code).toBe(0)
    expect(r.stderr).toMatch(/^health: FAILING \(error\) Scheduled job: check_sla: The last run failed\. Fix: /m)
  })

  test('health checks that cannot run are a warning, and the release still succeeds', async () => {
    await sql.unsafe('alter table featherbase.job_execution rename to job_execution_moved')
    const r = await runMain(main, [])
    expect(r.code).toBe(0)
    expect(r.stderr).toBe('health: the checks could not run: relation "featherbase.job_execution" does not exist\n')
  })

  test('a release that does not declare its environment stops before migrating', async () => {
    vi.stubEnv('FEATHERBASE_ENV', '')
    vi.stubEnv('NODE_ENV', '')
    const r = await runMain(main, [])
    expect(r.code).toBe(1)
    expect(r.stdout).toBe('')
    expect(r.stderr).toMatch(/^release failed — aborting: Neither FEATHERBASE_ENV nor NODE_ENV is set\. A release must declare its environment/)
  })
})
