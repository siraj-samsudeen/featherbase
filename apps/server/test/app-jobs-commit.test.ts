// #700, Codex round 2: a job's disable races a promotion on COMMITTED rows,
// through separate connections, so the database's locks decide. It runs on a
// disposable database of its own (scratch-database.ts), installed fresh, so
// its committed rows never touch the shared test database; the database is
// dropped afterwards, forcibly.
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { dropScratchDatabases, scratchInstalled } from './scratch-database'

afterAll(dropScratchDatabases, 60_000)

it('a failed settings read retries the job, then succeeds when the database is repaired', async () => {
  const scratch = await scratchInstalled()
  const dir = await mkdtemp(resolve('test/.app-jobs-'))
  try {
    const { sql } = await import('../src/db')
    const { discoverPackages } = await import('../src/runtime-packages')
    const { installApp } = await import('../src/apps')
    const { runOneJob } = await import('../src/jobs')
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'featherbase-setupretry', version: '1.0.0', type: 'module' }))
    await writeFile(join(dir, 'featherbase.json'), JSON.stringify({
      manifestVersion: 1, platformVersion: '2026-10', name: 'setupretry', title: 'Setup retry',
      entryTable: 'setupretry.note', server: 'server.mjs',
      tables: [{ name: 'setupretry.note', label: 'Note', id_pattern: 'prompt', columns: [{ column_name: 'body', column_type: 'Data' }] }],
      settings: [{ name: 'feed_id', required: false }],
      jobs: [{ name: 'tidy', cadence: 'daily', description: 'Record completion.' }],
    }))
    await writeFile(join(dir, 'server.mjs'), `export const platformVersion = '2026-10'
export const jobs = { async tidy(ctx) { ctx.setResult('tidied') } }
`)
    expect(await discoverPackages([dir])).toEqual([])
    await installApp('setupretry')
    const [job] = await sql`select row_id from background_job where method = 'setupretry.tidy'`
    // A real database read failure, isolated from every other test database.
    // Unlike a missing setting, it must be an error eligible for retry.
    await sql`alter table app_setting rename column value to unavailable_value`
    await sql`update background_job set run_at = now() - interval '1 second' where row_id = ${job.row_id}`
    expect(await runOneJob()).toBe(true)
    expect(await sql`select job_status, attempts from background_job where row_id = ${job.row_id}`)
      .toEqual([{ job_status: 'queued', attempts: 1 }])
    expect(await sql`select outcome, error from job_execution where job = ${job.row_id}`)
      .toEqual([{ outcome: 'error', error: expect.stringContaining('column "value" does not exist') }])
    await sql`alter table app_setting rename column unavailable_value to value`
    await sql`update background_job set run_at = now() - interval '1 second' where row_id = ${job.row_id}`
    expect(await runOneJob()).toBe(true)
    expect(await sql`select job_status, attempts from background_job where row_id = ${job.row_id}`)
      .toEqual([{ job_status: 'done', attempts: 2 }])
    expect(await sql`select outcome, result from job_execution where job = ${job.row_id} order by attempt`)
      .toEqual([{ outcome: 'error', result: null }, { outcome: 'success', result: 'tidied' }])
  } finally {
    await scratch.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 60_000)

it('a person promoted to System Manager while a job waits to disable them is left enabled', async () => {
  const scratch = await scratchInstalled()
  try {
    // Loaded against the scratch database: the module graph scratchInstalled set up.
    const { sql } = await import('../src/db')
    const { disablePerson } = await import('../src/app-jobs')
    const person = `psn_jobrace${randomUUID().slice(0, 8)}`
    await sql`insert into person ${sql({ row_id: person, email: null, full_name: person, enabled: true, created_by: 'Administrator', updated_by: 'Administrator' })}`

    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let locked!: () => void
    const holding = new Promise<void>((resolve) => { locked = resolve })
    // The promotion: holds the person's row while it adds the role.
    const promotion = scratch.db.begin(async (tx) => {
      await tx`select 1 from featherbase.person where row_id = ${person} for update`
      await tx`insert into featherbase.has_role (row_id, parent, parenttype, parentfield, role) values (${`hr-${person}`}, ${person}, 'Person', 'roles', 'System Manager')`
      await tx`update featherbase.person set updated_at = now() where row_id = ${person}`
      locked()
      await gate
    })
    await holding
    const disabling = disablePerson('jobrace.sweep', person, 'their code says they left')
    // Until the disable is waiting on the promotion's row lock.
    for (;;) {
      const [row] = await sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and query like 'select updated_at, enabled%for update%'`
      if (row.n > 0) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    release()
    await promotion
    expect(await disabling).toBe(false)
    expect(await sql`select enabled from person where row_id = ${person}`).toEqual([{ enabled: true }])
  } finally {
    await scratch.close()
  }
}, 60_000)
