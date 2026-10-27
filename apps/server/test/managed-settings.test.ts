// Instance settings as code, group 4 (#465, design D5): the fields the last
// successful apply set are locked. Every save path refuses to change them,
// except the apply itself (`instance-settings`) and the break-glass CLI
// (`cli`). Nothing is locked before the first apply.
import postgres from 'postgres'
import { describe, expect } from 'vitest'
import { INSTANCE_SETTINGS_FILE, INSTANCE_SETTINGS_TABLES, MANAGED_FIELD_HINT } from 'shared'
import { test } from './pg-test'
import { sql } from '../src/db'
import { config } from '../src/config'
import { applyInstanceSettings, managedScope } from '../src/instance-settings'
import { BREAK_GLASS_ACTOR, lastApply, managedFieldsOf, recordApply } from '../src/managed-settings'
import { runAsSystemActor } from '../src/system-actor'
import { deleteDoc, getDoc, renameDoc, saveDoc } from '../src/document'
import { expectApiError, patchDoc } from './fixtures'
import { applySeedPack } from '../src/seed-packs'
import { CORE_PEOPLE_REVIEW_JSON } from '../src/person-identifiers'

const DOMAINS = 'example.com,example.org'
const LOCKED = { status: 403, type: 'PermissionError', message: expect.stringContaining(`is set in the instance settings file (${INSTANCE_SETTINGS_FILE})`) }

const FILE = {
  settings: {
    'System Settings': { app_name: 'Locked Name' },
    'Sign In Method': [{ row_id: 'google', allowed_email_domains: DOMAINS }],
    'Scheduled Job': [{ row_id: 'disable_leavers', enabled: false }],
  },
}

async function apply(file: unknown = FILE, opts: { environment?: string; dryRun?: boolean } = {}) {
  return applyInstanceSettings(file, { by: 'Administrator', ...opts })
}

const google = async () => (await sql`select allowed_email_domains, label, updated_at from sign_in_method where row_id = 'google'`)[0]
const appName = async () => (await sql`select value from single_value where table_name = 'System Settings' and field = 'app_name'`)[0]?.value

describe('what is locked (D5)', () => {
  test('the lockable Tables are exactly the managed scope', async () => {
    expect((await managedScope()).map((s) => s.table)).toEqual([...INSTANCE_SETTINGS_TABLES])
  })

  test('nothing is locked before the first apply', async ({ admin }) => {
    await sql`delete from instance_settings_apply`
    expect(await lastApply()).toBeNull()
    expect(await managedFieldsOf('System Settings', 'System Settings')).toEqual([])
    const res = await admin.get<{ fields: string[] }>('/api/instance-settings/managed/System%20Settings/System%20Settings')
    expect(res).toEqual({ fields: [], hint: MANAGED_FIELD_HINT })
    await admin.post('/api/save_row', { table: 'System Settings', row: { app_name: 'Edited Freely' } })
    expect(await appName()).toBe('Edited Freely')
  })

  test('a successful apply stores the fields its file names, with the environment section on top', async ({ admin }) => {
    await apply({
      settings: { 'System Settings': { app_name: 'Base' } },
      environments: { dev: { settings: { 'System Settings': { time_zone: 'Asia/Kolkata' }, 'Sign In Method': [{ row_id: 'google', allowed_email_domains: DOMAINS }] } } },
    }, { environment: 'dev' })
    expect(await managedFieldsOf('System Settings', 'System Settings')).toEqual(['app_name', 'time_zone'])
    expect(await managedFieldsOf('Sign In Method', 'google')).toEqual(['allowed_email_domains'])
    expect(await managedFieldsOf('Sign In Method', 'password')).toEqual([])
    const stored = await lastApply()
    expect(stored).toMatchObject({ environment: 'dev', applied_by: 'Administrator' })
    const res = await admin.get('/api/instance-settings/managed/Sign%20In%20Method/google')
    expect(res).toEqual({ fields: ['allowed_email_domains'], hint: MANAGED_FIELD_HINT })
  })

  test('the apply records its source revision and run with the paths', async () => {
    await applyInstanceSettings(FILE, { by: 'Administrator', source: { revision: 'abc123', run: '42' } })
    expect(await lastApply()).toMatchObject({ revision: 'abc123', run: '42', environment: null })
  })

  test('a dry run and a refused apply leave the locked set as it was', async () => {
    await apply()
    await apply({ settings: { 'System Settings': { time_zone: 'UTC' } } }, { dryRun: true })
    await expect(apply({ settings: { 'System Settings': { time_zone: 'UTC', no_such_field: 1 } } })).rejects.toMatchObject({ type: 'ValidationError' })
    expect(await managedFieldsOf('System Settings', 'System Settings')).toEqual(['app_name'])
  })

  test('the next apply replaces the set: a field the file stops naming is editable again', async ({ admin }) => {
    await apply()
    await apply({ settings: { 'System Settings': { app_name: 'Locked Name' } } })
    expect(await managedFieldsOf('Sign In Method', 'google')).toEqual([])
    const row = await google()
    await patchDoc(admin, '/api/table/Sign%20In%20Method/google', { allowed_email_domains: 'example.net', updated_at: row.updated_at })
    expect((await google()).allowed_email_domains).toBe('example.net')
  })

  test('only a reader of the row learns which of its fields are locked', async ({ createUser }) => {
    await apply()
    const clerk = await createUser({ roles: [] })
    await expectApiError(clerk.get('/api/instance-settings/managed/Sign%20In%20Method/google'), { status: 403 })
  })
})

describe('Admin saves of a locked field are refused (D5)', () => {
  test('a System Manager cannot change a locked System Settings field, and nothing changes', async ({ createUser }) => {
    await apply()
    const manager = await createUser({ roles: ['System Manager'] })
    await expectApiError(manager.post('/api/save_row', { table: 'System Settings', row: { app_name: 'Drifted' } }), LOCKED)
    expect(await appName()).toBe('Locked Name')
  })

  test('the message names the field and says where it is changed', async ({ admin }) => {
    await apply()
    const err = await expectApiError(admin.post('/api/save_row', { table: 'System Settings', row: { app_name: 'Drifted' } }), LOCKED)
    expect(err.message).toContain(`App name on System Settings is set in the instance settings file (${INSTANCE_SETTINGS_FILE}), so it cannot be changed here. Change it in the file, then apply the file.`)
    expect(err.fields).toEqual({ app_name: 'set in the instance settings file' })
  })

  test('the form saving every field, with only an unlocked one changed, succeeds', async ({ admin }) => {
    await apply()
    const doc = await admin.get<Record<string, unknown>>('/api/table/System%20Settings/System%20Settings')
    await admin.post('/api/save_row', { table: 'System Settings', row: { ...doc, time_zone: 'Asia/Kolkata' } })
    expect(await appName()).toBe('Locked Name')
    const [tz] = await sql`select value from single_value where table_name = 'System Settings' and field = 'time_zone'`
    expect(tz.value).toBe('Asia/Kolkata')
  })

  test('a locked sign-in method field cannot be changed or cleared; its other fields can', async ({ admin }) => {
    await apply()
    const row = await google()
    await expectApiError(patchDoc(admin, '/api/table/Sign%20In%20Method/google', { allowed_email_domains: null, updated_at: row.updated_at }), LOCKED)
    expect((await google()).allowed_email_domains).toBe(DOMAINS)
    const doc = await admin.get<Record<string, unknown>>('/api/table/Sign%20In%20Method/google')
    await patchDoc(admin, '/api/table/Sign%20In%20Method/google', { ...doc, label: 'Google (company)' })
    expect(await google()).toMatchObject({ label: 'Google (company)', allowed_email_domains: DOMAINS })
  })

  test('a locked JSON field: echoing the object is no change; a JSON string with the same text is (Codex review)', async ({ admin }) => {
    await apply({ settings: { 'Sign In Method': [{ row_id: 'google', settings: { a: 1 } }] } })
    const stamp = async () => (await google()).updated_at
    await patchDoc(admin, '/api/table/Sign%20In%20Method/google', { settings: { a: 1 }, label: 'Google', updated_at: await stamp() })
    // jsonb keeps a string as a JSON string, a different value from the object.
    await expectApiError(patchDoc(admin, '/api/table/Sign%20In%20Method/google', { settings: '{"a":1}', updated_at: await stamp() }), LOCKED)
    const [row] = await sql`select settings from sign_in_method where row_id = 'google'`
    expect(row.settings).toEqual({ a: 1 })
  })

  test('a locked scheduled job switch cannot be flipped from Admin', async ({ admin }) => {
    await apply()
    const [job] = await sql`select updated_at from scheduled_job where row_id = 'disable_leavers'`
    await expectApiError(patchDoc(admin, '/api/table/Scheduled%20Job/disable_leavers', { enabled: true, updated_at: job.updated_at }), LOCKED)
  })

  test('the Administrator calling the engine directly is refused too', async () => {
    await apply()
    await expect(saveDoc('System Settings', { app_name: 'Drifted' }, 'Administrator')).rejects.toMatchObject({ type: 'PermissionError' })
  })

  test('a Document Event script that changes a locked field during another save is refused', async ({ admin }) => {
    await apply()
    await sql`insert into server_script ${sql({ row_id: 'drift-domains', script_type: 'Document Event', ref_table: 'Sign In Method', event: 'before_save', script: 'doc.allowed_email_domains = "evil.example"', enabled: true })}`
    const doc = await admin.get<Record<string, unknown>>('/api/table/Sign%20In%20Method/google')
    await expectApiError(patchDoc(admin, '/api/table/Sign%20In%20Method/google', { ...doc, label: 'Changed' }), LOCKED)
    expect((await google()).allowed_email_domains).toBe(DOMAINS)
  })

  test('an import that updates a locked field is refused, and nothing changes', async ({ admin }) => {
    await apply()
    await expectApiError(admin.post('/api/table/Sign%20In%20Method:import', {
      key_column: 'row_id', rows: [{ row_id: 'google', allowed_email_domains: 'evil.example' }],
    }), LOCKED)
    expect((await google()).allowed_email_domains).toBe(DOMAINS)
  })

  test('a locked row cannot be deleted or renamed, and a row cannot be created under a locked id', async ({ admin }) => {
    await apply()
    await expect(deleteDoc('Scheduled Job', 'disable_leavers', 'Administrator')).rejects.toMatchObject(LOCKED_ROW)
    await expect(renameDoc('Scheduled Job', 'disable_leavers', 'renamed_job', 'Administrator')).rejects.toMatchObject(LOCKED_ROW)
    await expectApiError(admin.post('/api/table/Scheduled%20Job/disable_leavers:rename', { new_name: 'renamed_job' }), { status: 403 })
    await sql`delete from scheduled_job where row_id = 'disable_leavers'`
    await expect(saveDoc('Scheduled Job', { row_id: 'disable_leavers', method: 'disable_leavers', cadence: 'daily', enabled: true }, 'Administrator', 'insert'))
      .rejects.toMatchObject(LOCKED_ROW)
  })

  test('renaming a row a locked field refers to is refused, so the cascade cannot change it', async () => {
    await apply({ settings: { 'Sign In Method': [{ row_id: 'google', identifier_system: null }] } })
    const [system] = await sql`select row_id from identifier_system limit 1`
    if (!system) return
    await sql`update sign_in_method set identifier_system = ${system.row_id} where row_id = 'google'`
    await expect(renameDoc('Identifier System', String(system.row_id), 'renamed_system', 'Administrator')).rejects.toMatchObject({ type: 'PermissionError' })
  })
})

describe('a seed pack leaves a locked field alone (Codex adversarial)', () => {
  test('the people review the file sets is kept, even at the core default', async () => {
    await sql`delete from single_value where table_name = 'System Settings' and field = 'people_review'`
    await apply({ settings: { 'System Settings': { people_review: JSON.parse(CORE_PEOPLE_REVIEW_JSON) } } })
    const result = await applySeedPack('jeyarama')
    expect(result.peopleReview).toBe('kept')
    const [row] = await sql`select value from single_value where table_name = 'System Settings' and field = 'people_review'`
    expect(JSON.parse(String(row.value))).toEqual(JSON.parse(CORE_PEOPLE_REVIEW_JSON))
  })
})

const LOCKED_ROW = { type: 'PermissionError', message: expect.stringContaining(INSTANCE_SETTINGS_FILE) }

describe('the apply and the break-glass CLI still change a locked field (D5)', () => {
  test('a later apply changes a locked field', async () => {
    await apply()
    await apply({ ...FILE, settings: { ...FILE.settings, 'System Settings': { app_name: 'Renamed By File' } } })
    expect(await appName()).toBe('Renamed By File')
  })

  test('the cli actor changes a locked field, and the version records cli', async () => {
    await apply()
    await runAsSystemActor(BREAK_GLASS_ACTOR, () => saveDoc('System Settings', { app_name: 'Emergency' }, BREAK_GLASS_ACTOR))
    expect(await appName()).toBe('Emergency')
    const [v] = await sql`select created_by from version where ref_table = 'System Settings' order by created_at desc limit 1`
    expect(v.created_by).toBe('cli')
    // It stays locked in Admin until the next apply.
    expect(await managedFieldsOf('System Settings', 'System Settings')).toEqual(['app_name'])
  })

  test('the name cli alone, outside the CLI, is no key', async () => {
    await apply()
    await expect(saveDoc('System Settings', { app_name: 'Forged' }, BREAK_GLASS_ACTOR)).rejects.toMatchObject({ type: 'PermissionError' })
    await expect(runAsSystemActor(BREAK_GLASS_ACTOR, () => saveDoc('System Settings', { app_name: 'Forged' }, 'Administrator')))
      .rejects.toMatchObject({ type: 'PermissionError' })
    expect((await getDoc('System Settings', 'System Settings', 'Administrator')).app_name).toBe('Locked Name')
  })
})

describe('how a locked value is compared (D5)', () => {
  const save = (admin: Parameters<typeof patchDoc>[0], row: Record<string, unknown>) =>
    admin.post('/api/save_row', { table: 'System Settings', row })

  test('a locked number is the same value however it is typed, and a different number is a change', async ({ admin }) => {
    await apply({ settings: { 'System Settings': { session_hours: 24, currency_precision: 2 } } })
    await save(admin, { session_hours: '24', currency_precision: 2.0 })
    await expectApiError(save(admin, { session_hours: 25 }), LOCKED)
    const [row] = await sql`select value from single_value where table_name = 'System Settings' and field = 'session_hours'`
    expect(Number(row.value)).toBe(24)
  })

  test('a locked JSON setting kept as text compares by content, not by spacing or key order; text that is not JSON is a change', async ({ admin }) => {
    await apply({ settings: { 'System Settings': { people_review: { b: 2, a: 1 } } } })
    await save(admin, { people_review: '{ "a": 1,   "b": 2 }' })
    await expectApiError(save(admin, { people_review: '{"a":1,"b":3}' }), LOCKED)
    await expectApiError(save(admin, { people_review: 'not json at all' }), LOCKED)
  })

  test('a locked setting that is a reference holds its row: renaming the row it names is refused', async () => {
    await sql`insert into column_def ${sql({ parent: 'System Settings', position: 997, column_name: 'default_identifier_test', label: null,
      column_type: 'Reference', reference_table: 'Identifier System', reqd: false, unique: false, default_value: null, read_only: false, hidden: false, in_list_view: false, tier: 'basic' })}`
    const { invalidateMeta } = await import('../src/meta')
    invalidateMeta('System Settings')
    try {
      await apply({ settings: { 'System Settings': { default_identifier_test: 'phone' } } })
      await expect(renameDoc('Identifier System', 'phone', 'phone_renamed', 'Administrator')).rejects.toMatchObject({ type: 'PermissionError' })
      // A row the setting does not name can still be renamed.
      await renameDoc('Identifier System', 'email', 'email_renamed', 'Administrator')
    } finally {
      await sql`delete from column_def where parent = 'System Settings' and column_name = 'default_identifier_test'`
      invalidateMeta('System Settings')
    }
  })
})

describe('a workflow step cannot rewrite a locked field', () => {
  test('applying a workflow action whose state field the file sets is refused, and nothing changes', async ({ admin }) => {
    await apply({ settings: { 'Scheduled Job': [{ row_id: 'disable_leavers', enabled: false }] } })
    await admin.post('/api/save_row', {
      table: 'Workflow',
      row: {
        row_id: 'Locked Switch Flow',
        ref_table: 'Scheduled Job',
        is_active: true,
        state_field: 'enabled',
        states: [{ state: 'false', target_status: 'draft' }, { state: 'true', target_status: 'draft' }],
        transitions: [{ state: 'false', action: 'Switch on', next_state: 'true', allowed: 'System Manager' }],
      },
    })
    const { applyWorkflowAction } = await import('../src/workflow')
    await expect(applyWorkflowAction('Scheduled Job', 'disable_leavers', 'Switch on', 'Administrator')).rejects.toMatchObject({
      type: 'PermissionError',
      message: expect.stringContaining(INSTANCE_SETTINGS_FILE),
    })
    const [job] = await sql`select enabled from scheduled_job where row_id = 'disable_leavers'`
    expect(job.enabled).toBe(false)
  })
})

// #493: a writer outside the save path checks the locked set and writes in
// one transaction holding the settings lock, so an apply can't publish a new
// locked set between its check and its write. Proven from another
// connection: an apply takes the lock, the write starts and must wait, the
// apply locks the very field the write targets and commits; the write must
// then see the new locked set. That connection commits outside the sandbox,
// so the apply record it replaces is put back afterwards.
const SETTINGS_LOCK = 'featherbase.instance_settings_lock'

async function applyLandsMidWrite<T>(write: () => Promise<T>, locks: { table: string; row_id: string; field: string }): Promise<PromiseSettledResult<T>> {
  const apply = postgres(config.databaseUrl, { max: 1, prepare: false, connection: { search_path: 'featherbase' } })
  let pending!: Promise<T>
  let previous: Record<string, unknown>[] = []
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
      previous = [...(await db`select * from instance_settings_apply`)]
      await recordApply(db, {
        applied_by: 'Administrator', environment: null, revision: null, run: null,
        managed_paths: [locks], managed_values: null,
      })
    })
    return (await Promise.allSettled([pending]))[0]
  } finally {
    await apply.begin(async (tx) => {
      await tx`delete from instance_settings_apply`
      // jsonb columns arrive decoded; send them back as JSON, not arrays.
      const json = (v: unknown) => (v === null ? null : tx.json(v as Parameters<typeof tx.json>[0]))
      for (const row of previous) {
        const restored = { ...row, managed_paths: json(row.managed_paths), managed_values: json(row.managed_values) }
        await tx`insert into instance_settings_apply ${tx(restored as unknown as Record<string, never>)}`
      }
    })
    await apply.end()
  }
}

describe('direct writes judge the locked set an apply in progress publishes (#493)', () => {
  test('a workflow action waits for the apply, then is refused on the field it locked', async ({ admin }) => {
    await admin.post('/api/save_row', {
      table: 'Workflow',
      row: {
        row_id: 'Lock Wait Flow',
        ref_table: 'Scheduled Job',
        is_active: true,
        state_field: 'enabled',
        states: [{ state: 'true', target_status: 'draft' }, { state: 'false', target_status: 'draft' }],
        transitions: [{ state: 'true', action: 'Switch off', next_state: 'false', allowed: 'System Manager' }],
      },
    })
    await sql`update scheduled_job set enabled = true where row_id = 'disable_leavers'`
    const { applyWorkflowAction } = await import('../src/workflow')
    const outcome = await applyLandsMidWrite(
      () => applyWorkflowAction('Scheduled Job', 'disable_leavers', 'Switch off', 'Administrator'),
      { table: 'Scheduled Job', row_id: 'disable_leavers', field: 'enabled' },
    )
    expect(outcome).toMatchObject({ status: 'rejected', reason: { type: 'PermissionError', message: expect.stringContaining(INSTANCE_SETTINGS_FILE) } })
    const [job] = await sql`select enabled from scheduled_job where row_id = 'disable_leavers'`
    expect(job.enabled).toBe(true)
  })

  test("an assignment rule's stamp waits for the apply, then leaves the field it locked alone", async () => {
    await saveDoc('Assignment Rule', {
      row_id: 'Lock Wait Rule',
      ref_table: 'Scheduled Job',
      assign_to_field: 'description',
      users: [{ user: 'Administrator' }],
    })
    const [before] = await sql`select description from scheduled_job where row_id = 'disable_leavers'`
    const { evaluateAssignmentRules } = await import('../src/assignment-rules')
    const outcome = await applyLandsMidWrite(
      () => evaluateAssignmentRules('Scheduled Job', { row_id: 'disable_leavers' }),
      { table: 'Scheduled Job', row_id: 'disable_leavers', field: 'description' },
    )
    expect(outcome.status).toBe('fulfilled')
    const [job] = await sql`select description from scheduled_job where row_id = 'disable_leavers'`
    expect(job.description).toBe(before.description)
  })
})
