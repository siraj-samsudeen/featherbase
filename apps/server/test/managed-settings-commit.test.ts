import postgres from 'postgres'
import { describe, expect, test } from 'vitest'
import { INSTANCE_SETTINGS_FILE } from 'shared'
import { config } from '../src/config'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { recordApply, type ManagedPath } from '../src/managed-settings'
import { applyWorkflowAction } from '../src/workflow'
import { evaluateAssignmentRules } from '../src/assignment-rules'

// #493, across real commits. A workflow action and an assignment rule's
// stamp write a row outside saveDoc; each must judge the locked set under the
// settings lock. Here an apply takes the lock, the write starts and queues
// behind it, the apply locks the very field the write targets and COMMITS,
// and the write must then honour that set. A sandbox can't show this (the
// write would never see the apply's uncommitted record), so this proof
// commits on independent connections. Opt in only on a disposable database
// (vitest.config.ts refuses any other name), and expect its records to stay:
//   SETTINGS_LOCK_COMMIT_PROOF=1 DATABASE_URL=postgres://...:5432/featherbase_<worker>_settings_commit_e2e \
//     FEATHERBASE_ENV=test pnpm --filter server exec vitest run test/managed-settings-commit.test.ts
const prove = process.env.SETTINGS_LOCK_COMMIT_PROOF === '1' ? test : test.skip
const SETTINGS_LOCK = 'featherbase.instance_settings_lock'

async function applyLandsMidWrite<T>(write: () => Promise<T>, locks: ManagedPath): Promise<PromiseSettledResult<T>> {
  const apply = postgres(config.databaseUrl, { max: 1, prepare: false, connection: { search_path: 'featherbase' } })
  let pending!: Promise<T>
  try {
    await apply.begin(async (tx) => {
      const db = tx as unknown as typeof sql
      await db`select pg_advisory_xact_lock(hashtext(${SETTINGS_LOCK}))`
      pending = write()
      pending.catch(() => {})
      await expect.poll(async () => (await db`
        select count(*)::int as n from pg_locks
        where locktype = 'advisory' and mode = 'ShareLock' and not granted
          and database = (select oid from pg_database where datname = current_database())
          and objsubid = 1 and objid::bigint = (hashtext(${SETTINGS_LOCK})::bigint & 4294967295)`)[0].n, { timeout: 3000 }).toBe(1)
      await recordApply(db, { applied_by: 'Administrator', environment: null, revision: null, run: null, managed_paths: [locks], managed_values: null })
    })
  } finally {
    await apply.end()
  }
  return (await Promise.allSettled([pending]))[0]
}

describe('direct writes honour a locked set an apply commits mid-write (#493)', () => {
  prove('this is a disposable test database', async () => {
    const [identity] = await sql`select current_database() as name,
      (select value from internal_metadata where key = 'environment') as environment`
    expect(String(identity.name)).toMatch(/^featherbase_[a-z0-9_]+_settings_commit_e2e$/)
    expect(identity.environment).toBe('test')
  })

  prove('a workflow action is refused on the field the apply locked', async () => {
    await saveDoc('Workflow', {
      row_id: `Commit Proof Flow ${Date.now()}`,
      ref_table: 'Scheduled Job',
      is_active: true,
      state_field: 'enabled',
      states: [{ state: 'true', target_status: 'draft' }, { state: 'false', target_status: 'draft' }],
      transitions: [{ state: 'true', action: 'Switch off', next_state: 'false', allowed: 'System Manager' }],
    })
    try {
      await sql`update scheduled_job set enabled = true where row_id = 'disable_leavers'`
      const outcome = await applyLandsMidWrite(
        () => applyWorkflowAction('Scheduled Job', 'disable_leavers', 'Switch off', 'Administrator'),
        { table: 'Scheduled Job', row_id: 'disable_leavers', field: 'enabled' },
      )
      expect(outcome).toMatchObject({ status: 'rejected', reason: { type: 'PermissionError', message: expect.stringContaining(INSTANCE_SETTINGS_FILE) } })
      const [job] = await sql`select enabled from scheduled_job where row_id = 'disable_leavers'`
      expect(job.enabled).toBe(true)
    } finally {
      // One active workflow per Table: switch this one off for later runs.
      await sql`update workflow set is_active = false where ref_table = 'Scheduled Job'`
    }
  })

  prove("an assignment rule's stamp leaves the field the apply locked alone", async () => {
    const rule = `Commit Proof Rule ${Date.now()}`
    await saveDoc('Assignment Rule', { row_id: rule, ref_table: 'Scheduled Job', assign_to_field: 'description', users: [{ user: 'Administrator' }] })
    try {
      const [before] = await sql`select description from scheduled_job where row_id = 'disable_leavers'`
      const outcome = await applyLandsMidWrite(
        () => evaluateAssignmentRules('Scheduled Job', { row_id: 'disable_leavers' }),
        { table: 'Scheduled Job', row_id: 'disable_leavers', field: 'description' },
      )
      expect(outcome.status).toBe('fulfilled')
      const [job] = await sql`select description from scheduled_job where row_id = 'disable_leavers'`
      expect(job.description).toBe(before.description)
    } finally {
      await sql`update assignment_rule set disabled = true where row_id = ${rule}`
    }
  })
})
