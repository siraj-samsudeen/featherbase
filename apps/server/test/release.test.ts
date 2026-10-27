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
  test('on an up-to-date database it applies nothing and reports the preflight, the patches and the health checks', async () => {
    const r = await runMain(main, [])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/^preflight: /)
    expect(r.stdout).toContain('preflight: pending migrations: none\n')
    expect(r.stdout).toContain('patches up to date (1 total)\n')
    expect(r.stdout).not.toContain('applied patch')
    expect(r.stdout).toMatch(/\nhealth: passing /)
  })

  test('applies a patch not yet recorded', async () => {
    await sql`delete from patch_log where patch = '0001_file_ref_index'`
    const r = await runMain(main, [])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('applied patch 0001_file_ref_index\npatches up to date (1 total)\n')
    expect(await sql`select 1 from patch_log where patch = '0001_file_ref_index'`).toHaveLength(1)
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
    expect(r.stdout).toContain('patches up to date (1 total)\n')
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
