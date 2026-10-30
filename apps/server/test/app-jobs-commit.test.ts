// #700, Codex round 2: a job's disable races a promotion on COMMITTED rows,
// through separate connections, so the database's locks decide. It runs on a
// disposable database of its own (scratch-database.ts), installed fresh, so
// its committed rows never touch the shared test database; the database is
// dropped afterwards, forcibly.
import { randomUUID } from 'node:crypto'
import { afterAll, expect, it } from 'vitest'
import { dropScratchDatabases, scratchInstalled } from './scratch-database'

afterAll(dropScratchDatabases, 60_000)

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
