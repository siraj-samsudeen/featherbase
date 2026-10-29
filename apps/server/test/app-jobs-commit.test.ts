// #700, Codex round 2: a job's disable races a promotion on COMMITTED rows,
// through separate pool connections, so the database's locks decide. Not
// sandboxed: every row this file writes carries a unique prefix and is
// removed in finally.
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { sql } from '../src/db'
import { disablePerson } from '../src/app-jobs'

// Resolves once another backend waits on a lock to take the person's row.
async function waitingOnLock() {
  for (;;) {
    const [row] = await sql`select count(*)::int as n from pg_stat_activity
      where wait_event_type = 'Lock' and query like '%person where row_id = %for update%' and query like 'select updated_at, enabled%'`
    if (row.n > 0) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

it('a person promoted to System Manager while a job waits to disable them is left enabled', async () => {
  const person = `psn_jobrace${randomUUID().slice(0, 8)}`
  await sql`insert into person ${sql({ row_id: person, email: null, full_name: person, enabled: true, created_by: 'Administrator', updated_by: 'Administrator' })}`
  try {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let locked!: () => void
    const holding = new Promise<void>((resolve) => { locked = resolve })
    // The promotion: holds the person's row while it adds the role.
    const promotion = sql.begin(async (tx) => {
      await tx`select 1 from person where row_id = ${person} for update`
      await tx`insert into has_role (row_id, parent, parenttype, parentfield, role) values (${`hr-${person}`}, ${person}, 'Person', 'roles', 'System Manager')`
      await tx`update person set updated_at = now() where row_id = ${person}`
      locked()
      await gate
    })
    await holding
    const disabling = disablePerson('jobrace.sweep', person, 'their code says they left')
    await waitingOnLock()
    release()
    await promotion
    expect(await disabling).toBe(false)
    const [after] = await sql`select enabled from person where row_id = ${person}`
    expect(after.enabled).toBe(true)
  } finally {
    await sql`delete from has_role where parent = ${person}`
    await sql`delete from activity_log where "user" = 'jobrace.sweep'`
    await sql`delete from person where row_id = ${person}`
  }
})
