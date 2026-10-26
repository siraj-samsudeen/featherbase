// Instance settings as code, group 4 (#465, design D5): the fields the last
// successful apply set are locked. Every save path refuses to change them,
// except the apply itself (`instance-settings`) and the break-glass CLI
// (`cli`). Nothing is locked before the first apply.
import { describe, expect } from 'vitest'
import { INSTANCE_SETTINGS_FILE, INSTANCE_SETTINGS_TABLES, MANAGED_FIELD_HINT } from 'shared'
import { test } from './pg-test'
import { sql } from '../src/db'
import { applyInstanceSettings, managedScope } from '../src/instance-settings'
import { BREAK_GLASS_ACTOR, lastApply, managedFieldsOf } from '../src/managed-settings'
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
