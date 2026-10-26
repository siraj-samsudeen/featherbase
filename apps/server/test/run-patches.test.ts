// `tsx src/run-patches.ts` (init.sh's patch step) run in this process through
// `main(argv, io)` (ADR 0012), inside a rolled-back sandbox; one case runs it
// as a process, to prove the entry point. The runner itself is in
// patches.test.ts.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { main } from '../src/run-patches'
import { runMain } from './command-io'
import { test } from './pg-test'

describe('run-patches', () => {
  test('applies a patch not yet recorded and reports the total', async () => {
    await sql`delete from patch_log where patch = '0001_file_ref_index'`
    expect(await runMain(main, [])).toEqual({ code: 0, stdout: 'applied patch 0001_file_ref_index\npatches up to date (1 total)\n', stderr: '' })
    expect(await runMain(main, [])).toEqual({ code: 0, stdout: 'patches up to date (1 total)\n', stderr: '' })
  })

  test('a failing patch aborts with exit code 1 and is not recorded', async () => {
    await sql`delete from patch_log where patch = '0001_file_ref_index'`
    await sql.unsafe('alter table featherbase.file rename to file_moved')
    expect(await runMain(main, [])).toEqual({ code: 1, stdout: '', stderr: 'patch failed — aborting: relation "featherbase.file" does not exist\n' })
    expect(await sql`select 1 from patch_log where patch = '0001_file_ref_index'`).toHaveLength(0)
  })

  // A fresh test database is migrated by the suite's global setup but never
  // patched, so the first real run may apply the patch before it reports.
  // Either way the process ends up to date, and a second run applies nothing.
  it('runs as a process: it brings the database up to date, then applies nothing', () => {
    const server = fileURLToPath(new URL('..', import.meta.url))
    const run = () => execFileSync(process.execPath, ['--import', 'tsx', 'src/run-patches.ts'], { cwd: server, encoding: 'utf8', timeout: 60_000 })
    expect(run()).toMatch(/patches up to date \(1 total\)\n$/)
    expect(run()).toBe('patches up to date (1 total)\n')
  }, 120_000)
})
