// Instance settings as code, group 3 (#465, design D2–D4, D9): the managed
// scope, apply, dry run, and export. Apply runs in one transaction through
// saveDoc as actor `instance-settings`; a dry run and a wrong file write
// nothing; an export never carries a secret.
import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { AppError } from '../src/errors'
import {
  INSTANCE_SETTINGS_ACTOR,
  applyInstanceSettings,
  exportInstanceSettings,
  managedScope,
  settingsDrift,
  type InstanceSettingsFile,
} from '../src/instance-settings'
import { createServiceAccount } from '../src/service-accounts'
import { issueAccessToken } from '../src/auth'
import { makePerson } from './fixtures'

afterEach(() => vi.unstubAllEnvs())

const DOMAINS = 'example.com,example.org,example.net,example.edu'

/** Everything an apply could touch, as rows, so "nothing written" is a
 *  deep-equal of two snapshots. */
async function snapshot() {
  return {
    versions: await sql`select row_id, ref_table, ref_name, data from version order by row_id`,
    settings: await sql`select table_name, field, value from single_value order by table_name, field`,
    methods: await sql`select * from sign_in_method order by row_id`,
    jobs: await sql`select * from scheduled_job order by row_id`,
    activity: await sql`select row_id, "user", operation from activity_log order by row_id`,
  }
}

async function problemsOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(AppError)
    return err as AppError
  }
  throw new Error('expected the apply to be refused')
}

describe('the managed scope (D2)', () => {
  test('is declared by the framework: System Settings fields, sign-in method rows, a scheduled job\'s enabled switch, an app setting\'s value', async () => {
    const scope = await managedScope()
    expect(scope.map((s) => [s.table, s.shape, s.fields])).toEqual([
      ['System Settings', 'settings', [
        'app_name', 'time_zone', 'date_format', 'session_hours', 'allow_signup', 'currency',
        'currency_precision', 'float_precision', 'people_review', 'privacy_notice', 'invitation_email_intro',
      ]],
      ['Sign In Method', 'rows', [
        'kind', 'label', 'enabled', 'new_person', 'allowed_email_domains', 'self_link', 'client_id',
        'service_url', 'settings', 'identifier_system',
      ]],
      ['Scheduled Job', 'rows', ['cadence', 'enabled']],
      ['App Setting', 'rows', ['value']],
      ['Data Source', 'rows', ['engine', 'url_env', 'default_schema', 'access', 'table_allowlist']],
    ])
    // The privacy notice may be kept in its own file next to the settings file.
    expect(scope[0].fileFields).toContain('privacy_notice')
    // The logo is an uploaded file in this instance's own storage (#380), which no file can carry.
    expect(scope[0].fields).not.toContain('logo')
  })

  test('never includes a secret: no Password field, whatever a later migration adds', async () => {
    await sql`insert into column_def ${sql({ parent: 'System Settings', position: 998, column_name: 'smtp_secret_test', label: null,
      column_type: 'Password', reqd: false, unique: false, default_value: null, read_only: false, hidden: false, in_list_view: false, tier: 'basic' })}`
    const { invalidateMeta } = await import('../src/meta')
    invalidateMeta('System Settings')
    try {
      const scope = await managedScope()
      expect(scope[0].fields).not.toContain('smtp_secret_test')
    } finally {
      await sql`delete from column_def where parent = 'System Settings' and column_name = 'smtp_secret_test'`
      invalidateMeta('System Settings')
    }
  })
})

describe('apply (D4)', () => {
  // #693: the Sign In Method controller refuses a malformed domain list, and
  // the settings file saves through it, so a typo there lands nothing.
  test('a domain list with a space inside an entry is refused and nothing changes', async () => {
    await sql`update sign_in_method set allowed_email_domains = ${DOMAINS} where row_id = 'google'`
    const file: InstanceSettingsFile = { settings: { 'Sign In Method': [{ row_id: 'google', allowed_email_domains: 'exam ple.com' }] } }
    await expect(applyInstanceSettings(file, { by: 'Administrator' })).rejects.toThrow('"exam ple.com" is not a domain such as example.com, or *')
    expect(await sql`select allowed_email_domains from sign_in_method where row_id = 'google'`).toEqual([{ allowed_email_domains: DOMAINS }])
  })

  test('a missing company domain is restored, and the result names that one setting', async () => {
    await sql`update sign_in_method set allowed_email_domains = null where row_id = 'google'`
    const file: InstanceSettingsFile = { settings: { 'Sign In Method': [{ row_id: 'google', allowed_email_domains: DOMAINS }] } }
    const result = await applyInstanceSettings(file, { by: 'Administrator', source: { revision: 'a'.repeat(40), run: '12345' } })
    expect(result.dry_run).toBe(false)
    expect(result.changes).toEqual([
      { table: 'Sign In Method', row_id: 'google', field: 'allowed_email_domains', old: null, new: DOMAINS },
    ])
    expect(result.summary).toBe('1 setting changed')
    const [google] = await sql`select allowed_email_domains, updated_by from sign_in_method where row_id = 'google'`
    expect(google).toEqual({ allowed_email_domains: DOMAINS, updated_by: INSTANCE_SETTINGS_ACTOR })
    // Through the normal save path, so it is in the row's history...
    const [version] = await sql`select created_by, data from version
      where ref_table = 'Sign In Method' and ref_name = 'google' order by created_at desc limit 1`
    expect(version.created_by).toBe(INSTANCE_SETTINGS_ACTOR)
    expect(version.data).toEqual({ changed: [['allowed_email_domains', null, DOMAINS]] })
    // ...and the Activity Log names the source revision and who sent it.
    const [log] = await sql`select "user", operation, full_name from activity_log
      where "user" = ${INSTANCE_SETTINGS_ACTOR} order by created_at desc limit 1`
    expect(log).toEqual({
      user: INSTANCE_SETTINGS_ACTOR,
      operation: `settings_apply revision ${'a'.repeat(40)} run 12345: 1 setting changed`,
      full_name: 'instance settings file, applied by Administrator',
    })
  })

  test('applying an unchanged file says nothing changed, and writes nothing', async () => {
    const file: InstanceSettingsFile = {
      settings: {
        'System Settings': { app_name: 'Feather Dash', session_hours: 10, allow_signup: false, people_review: { systems: ['x'] } },
        'Sign In Method': [{ row_id: 'google', allowed_email_domains: DOMAINS, enabled: true }],
        'Scheduled Job': [{ row_id: 'check_sla', enabled: false }],
      },
    }
    const first = await applyInstanceSettings(file, { by: 'Administrator' })
    expect(first.changes.length).toBeGreaterThan(0)
    const before = await snapshot()
    const second = await applyInstanceSettings(file, { by: 'Administrator' })
    expect(second.changes).toEqual([])
    expect(second.summary).toBe('nothing changed')
    const after = await snapshot()
    // Only the Activity Log grows: an apply is recorded even when it changes nothing.
    expect({ ...after, activity: [] }).toEqual({ ...before, activity: [] })
  })

  test('setting a field that only has its default is a change, even to null or false (Codex bot P2)', async () => {
    await sql`delete from single_value where table_name = 'System Settings' and field in ('app_name', 'allow_signup')`
    const result = await applyInstanceSettings({ settings: { 'System Settings': { app_name: null, allow_signup: false } } }, { by: 'Administrator' })
    expect(result.changes).toEqual([
      { table: 'System Settings', row_id: 'System Settings', field: 'app_name', old: null, new: null, was_default: true },
      { table: 'System Settings', row_id: 'System Settings', field: 'allow_signup', old: null, new: false, was_default: true },
    ])
    expect(await sql`select field, value from single_value where table_name = 'System Settings' and field in ('app_name', 'allow_signup') order by field`)
      .toEqual([{ field: 'allow_signup', value: '0' }, { field: 'app_name', value: null }])
    expect((await applyInstanceSettings({ settings: { 'System Settings': { app_name: null, allow_signup: false } } }, { by: 'Administrator' })).changes).toEqual([])
  })

  test('a System Settings change is versioned through the normal save path', async () => {
    await applyInstanceSettings({ settings: { 'System Settings': { app_name: 'Before' } } }, { by: 'Administrator' })
    await applyInstanceSettings({ settings: { 'System Settings': { app_name: 'After' } } }, { by: 'Administrator' })
    const [version] = await sql`select created_by, data from version
      where ref_table = 'System Settings' and ref_name = 'System Settings' order by created_at desc limit 1`
    expect(version).toEqual({ created_by: INSTANCE_SETTINGS_ACTOR, data: { changed: [['app_name', 'Before', 'After']] } })
  })

  test('a setting that was renamed: the file changes nothing and every problem is named', async () => {
    const before = await snapshot()
    const err = await problemsOf(applyInstanceSettings({
      settings: {
        // Valid on its own, so the rollback is what keeps it out.
        'System Settings': { app_name: 'Should Not Land', allowed_login_domains: 'example.com', date_format: 'not-a-format' },
        'Sign In Method': [{ row_id: 'google', allowed_email_domains: 'x.com' }],
        'Scheduled Job': [{ row_id: 'no_such_job', enabled: true }, { row_id: 'check_sla', description: 'Not the file\'s to set.' }],
        'Person': [{ row_id: 'Administrator', email: 'x@example.com' }],
      },
    } as unknown as InstanceSettingsFile, { by: 'Administrator' }))
    expect(err.type).toBe('ValidationError')
    expect(err.message).toContain('The settings file was not applied')
    expect(err.fields).toMatchObject({
      'System Settings.allowed_login_domains': 'System Settings has no field allowed_login_domains',
      'System Settings.date_format': expect.stringContaining('not-a-format'),
      'Scheduled Job.no_such_job': 'Scheduled Job has no row no_such_job',
      'Scheduled Job.check_sla.description': 'Scheduled Job.description is not managed by the settings file (it manages: cadence, enabled)',
      Person: 'Person is not managed by the settings file (it manages: System Settings, Sign In Method, Scheduled Job, App Setting, Data Source)',
    })
    expect(await snapshot()).toEqual(before)
  })

  test('a value of the wrong type is refused before anything is saved', async () => {
    const err = await problemsOf(applyInstanceSettings({
      settings: { 'System Settings': { session_hours: '12', allow_signup: 'yes' } },
    } as unknown as InstanceSettingsFile, { by: 'Administrator' }))
    expect(err.fields).toEqual({
      'System Settings.session_hours': 'System Settings.session_hours wants a whole number',
      'System Settings.allow_signup': 'System Settings.allow_signup wants true or false',
    })
  })

  test('a sign-in method row the file names but the environment lacks is created', async () => {
    const result = await applyInstanceSettings({
      settings: { 'Sign In Method': [{ row_id: 'stylehr', kind: 'delegated_password', label: 'StyleHR', enabled: false, service_url: 'https://hr.example.com/login' }] },
    }, { by: 'Administrator' })
    expect(result.changes).toContainEqual({ table: 'Sign In Method', row_id: 'stylehr', field: 'label', old: null, new: 'StyleHR', created: true })
    const [row] = await sql`select kind, created_by from sign_in_method where row_id = 'stylehr'`
    expect(row).toEqual({ kind: 'delegated_password', created_by: INSTANCE_SETTINGS_ACTOR })
  })
})

describe('values that differ by environment', () => {
  const file: InstanceSettingsFile = {
    settings: { 'Scheduled Job': [{ row_id: 'disable_leavers', enabled: true }] },
    environments: {
      dev: { settings: { 'Scheduled Job': [{ row_id: 'disable_leavers', enabled: false }] } },
      production: {},
    },
  }

  test('a job is off only on dev', async () => {
    await applyInstanceSettings(file, { by: 'Administrator', environment: 'production' })
    const [prod] = await sql`select enabled from scheduled_job where row_id = 'disable_leavers'`
    expect(prod.enabled).toBe(true)
    const dev = await applyInstanceSettings(file, { by: 'Administrator', environment: 'dev' })
    expect(dev.changes).toEqual([{ table: 'Scheduled Job', row_id: 'disable_leavers', field: 'enabled', old: true, new: false }])
  })

  test('an environment the file does not list is refused, so a typo cannot apply the base alone', async () => {
    const err = await problemsOf(applyInstanceSettings(file, { by: 'Administrator', environment: 'prod' }))
    expect(err.message).toContain('The settings file has no environment "prod" (it lists: dev, production)')
    const missing = await problemsOf(applyInstanceSettings(file, { by: 'Administrator' }))
    expect(missing.message).toContain('Name the environment to apply (the file lists: dev, production)')
  })
})

describe('dry run', () => {
  test('previewing a file that adds a company domain names the setting with its old and new value, and writes nothing', async () => {
    await applyInstanceSettings({ settings: { 'Sign In Method': [{ row_id: 'google', allowed_email_domains: 'example.com' }] } }, { by: 'Administrator' })
    const before = await snapshot()
    const preview = await applyInstanceSettings({
      settings: {
        'Sign In Method': [{ row_id: 'google', allowed_email_domains: 'example.com,example.org' }],
        'System Settings': { app_name: 'Previewed' },
        'Scheduled Job': [{ row_id: 'check_sla', enabled: false }],
      },
    }, { by: 'Administrator', dryRun: true, source: { revision: 'b'.repeat(40) } })
    expect(preview.dry_run).toBe(true)
    expect(preview.changes).toContainEqual({
      table: 'Sign In Method', row_id: 'google', field: 'allowed_email_domains', old: 'example.com', new: 'example.com,example.org',
    })
    expect(preview.summary).toBe('3 settings would change')
    // Row versions, settings, rows and the Activity Log are exactly as they were.
    expect(await snapshot()).toEqual(before)
  })

  test('a dry run of a wrong file reports the same problems as a real apply', async () => {
    const err = await problemsOf(applyInstanceSettings({ settings: { 'System Settings': { no_field: 1 } } } as unknown as InstanceSettingsFile, { by: 'Administrator', dryRun: true }))
    expect(err.fields).toEqual({ 'System Settings.no_field': 'System Settings has no field no_field' })
  })
})

describe('a feature\'s secret is required while the feature is on (D7)', () => {
  test('turning on Google sign-in for an environment without the Google secret changes nothing and names the secret', async () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    await sql`update sign_in_method set enabled = false, client_id = null where row_id = 'google'`
    const before = await snapshot()
    const err = await problemsOf(applyInstanceSettings({
      settings: { 'Sign In Method': [{ row_id: 'google', enabled: true, client_id: 'client.apps.googleusercontent.com' }] },
    }, { by: 'Administrator', serverEnvironment: 'production' }))
    expect(err.fields).toEqual({
      GOOGLE_CLIENT_SECRET: 'GOOGLE_CLIENT_SECRET is not set on this "production" server, and with this file a Google sign-in method is enabled with a client id. Set the variable first, then apply again.',
    })
    expect(await snapshot()).toEqual(before)
  })

  test('with the secret set, it applies', async () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'a-google-secret')
    await sql`update sign_in_method set enabled = false, client_id = null where row_id = 'google'`
    const result = await applyInstanceSettings({
      settings: { 'Sign In Method': [{ row_id: 'google', enabled: true, client_id: 'client.apps.googleusercontent.com' }] },
    }, { by: 'Administrator', serverEnvironment: 'production' })
    expect(result.changes.map((c) => c.field)).toEqual(['enabled', 'client_id'])
  })
})

describe('file references', () => {
  test('the privacy notice is read from the file the settings name', async () => {
    const notice = '# Privacy notice\n\nWe hold your name.\n'
    const result = await applyInstanceSettings({ settings: { 'System Settings': { privacy_notice: { file: 'privacy-notice.md' } } } }, {
      by: 'Administrator', files: { 'privacy-notice.md': notice },
    })
    expect(result.changes).toEqual([expect.objectContaining({ table: 'System Settings', row_id: 'System Settings', field: 'privacy_notice', new: notice })])
  })

  test('a reference to a file that was not sent is a problem, not an empty notice', async () => {
    const err = await problemsOf(applyInstanceSettings({ settings: { 'System Settings': { privacy_notice: { file: 'missing.md' } } } }, { by: 'Administrator' }))
    expect(err.fields).toEqual({ 'System Settings.privacy_notice': 'System Settings.privacy_notice names the file missing.md, which was not provided' })
  })
})

describe('export (D9)', () => {
  test('starting the file from an environment: export, then apply the result, changes nothing', async () => {
    await applyInstanceSettings({
      settings: {
        'System Settings': { app_name: 'Round Trip', people_review: { systems: ['a', 'b'] }, session_hours: 9 },
        'Sign In Method': [{ row_id: 'google', allowed_email_domains: DOMAINS }],
      },
    }, { by: 'Administrator' })
    const exported = await exportInstanceSettings()
    expect(exported.file.settings['System Settings']).toMatchObject({ app_name: 'Round Trip', session_hours: 9, people_review: { systems: ['a', 'b'] } })
    const result = await applyInstanceSettings(exported.file, { by: 'Administrator' })
    expect(result.changes).toEqual([])
  })

  test('a JSON column holding a JSON string round-trips as that string (Codex P2)', async () => {
    await sql`insert into sign_in_method ${sql({
      row_id: 'stringy', created_by: 'Administrator', updated_by: 'Administrator', created_at: new Date(), updated_at: new Date(), status: 'draft', position: 0,
      kind: 'delegated_password', label: 'Stringy', enabled: false, new_person: 'refuse', self_link: false, settings: sql.json('{}'),
    } as never)}`
    const exported = await exportInstanceSettings()
    expect((exported.file.settings['Sign In Method'] as Record<string, unknown>[]).find((r) => r.row_id === 'stringy')).toMatchObject({ settings: '{}' })
    const before = await sql`select settings, updated_at from sign_in_method where row_id = 'stringy'`
    expect((await applyInstanceSettings(exported.file, { by: 'Administrator' })).changes).toEqual([])
    expect(await sql`select settings, updated_at from sign_in_method where row_id = 'stringy'`).toEqual(before)
  })

  test('never contains a password, client secret, token or connection string', async () => {
    const secrets = {
      DATABASE_URL: 'postgres://app:db-pass-123456@db.internal:5432/featherbase',
      JWT_SECRET: 'jwt-secret-value-0123456789',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-google-client-secret',
      SMTP_PASSWORD: 'abcdefghijklmnop',
      MOTHERDUCK_TOKEN: 'md-token-value-987654321',
    }
    for (const [name, value] of Object.entries(secrets)) vi.stubEnv(name, value)
    // Secrets that reached a setting by mistake: pasted into a text field, in
    // a URL's credentials, under a JSON key that names one.
    await sql`insert into single_value ${sql({ table_name: 'System Settings', field: 'invitation_email_intro', value: `Our relay password is ${secrets.SMTP_PASSWORD}` })}
      on conflict (table_name, field) do update set value = excluded.value`
    await sql`insert into sign_in_method ${sql({
      row_id: 'leaky', created_by: 'Administrator', updated_by: 'Administrator', created_at: new Date(), updated_at: new Date(), status: 'draft', position: 0,
      kind: 'delegated_password', label: 'Leaky', enabled: false, new_person: 'refuse', self_link: false,
      service_url: 'https://bot:hunter2-url-password@hr.example.com/login',
      settings: sql.json({ username_key: 'user', api_token: 'tok-in-json-1234', nested: { client_secret: 'nested-secret-5678' } }),
    } as never)}`
    const exported = await exportInstanceSettings()
    const text = JSON.stringify(exported)
    for (const value of [...Object.values(secrets), 'hunter2-url-password', 'tok-in-json-1234', 'nested-secret-5678'])
      expect(text).not.toContain(value)
    expect(exported.withheld).toEqual([
      'System Settings.invitation_email_intro: holds the value of SMTP_PASSWORD',
      'Sign In Method.leaky.service_url: a web address with credentials in it',
      'Sign In Method.leaky.settings: holds keys that name a secret (api_token, nested.client_secret)',
    ])
    // The rest of the row is still exported.
    const leaky = (exported.file.settings['Sign In Method'] as Record<string, unknown>[]).find((r) => r.row_id === 'leaky')
    expect(leaky).toMatchObject({ row_id: 'leaky', label: 'Leaky' })
    expect(leaky).not.toHaveProperty('service_url')
  })
})

describe('export: credentials no deployment variable holds', () => {
  test('a token in a query string, a DSN password, an authorization value and secret keys in JSON text are left out', async () => {
    const leaks = {
      query: 'https://hr.example.com/login?user=bot&token=ext-provider-token-1',
      dsn: 'host=db.example.com port=5432 user=app password=dsn-pass-77 dbname=hr',
      bearer: 'Send it with Authorization: Bearer abcdefgh12345678',
      jsonText: '{"endpoint":"https://x.example.com","api_key":"k-json-text-99"}',
    }
    await sql`insert into sign_in_method ${sql({
      row_id: 'leaky2', created_by: 'Administrator', updated_by: 'Administrator', created_at: new Date(), updated_at: new Date(), status: 'draft', position: 0,
      kind: 'delegated_password', label: 'Leaky Two', enabled: false, new_person: 'refuse', self_link: false, service_url: leaks.query,
    } as never)}`
    for (const [field, value] of [['time_zone', leaks.dsn], ['invitation_email_intro', leaks.bearer], ['app_name', leaks.jsonText]])
      await sql`insert into single_value ${sql({ table_name: 'System Settings', field, value })}
        on conflict (table_name, field) do update set value = excluded.value`
    const exported = await exportInstanceSettings()
    const text = JSON.stringify(exported.file)
    for (const secret of ['ext-provider-token-1', 'dsn-pass-77', 'abcdefgh12345678', 'k-json-text-99']) expect(text).not.toContain(secret)
    expect(exported.withheld).toEqual(expect.arrayContaining([
      'Sign In Method.leaky2.service_url: names a secret with its value (a password=, token= or key= setting)',
      'System Settings.time_zone: names a secret with its value (a password=, token= or key= setting)',
      'System Settings.invitation_email_intro: holds an authorization value',
      'System Settings.app_name: holds a key that names a secret (api_key)',
    ]))
  })

  test('ordinary prose and addresses are exported as they are', async () => {
    const intro = 'Sign in with your work account. Your password is never shared, and the token you get expires.'
    await sql`insert into single_value ${sql({ table_name: 'System Settings', field: 'invitation_email_intro', value: intro })}
      on conflict (table_name, field) do update set value = excluded.value`
    const exported = await exportInstanceSettings()
    expect(exported.file.settings['System Settings']).toMatchObject({ invitation_email_intro: intro })
    expect(exported.withheld).toEqual([])
  })
})

describe('over HTTP (D3)', () => {
  test('a System Manager service account applies and previews; anyone else is refused', async ({ api }) => {
    const bot = await createServiceAccount('settings-bot', ['System Manager'], 'Administrator')
    const { token } = await issueAccessToken(bot.row_id, 'settings workflow', null)
    const auth = { authorization: `Bearer ${token}` }
    await sql`update sign_in_method set allowed_email_domains = null where row_id = 'google'`
    const body = {
      file: { settings: { 'Sign In Method': [{ row_id: 'google', allowed_email_domains: DOMAINS }] } },
      source: { revision: 'c'.repeat(40), run: '987' },
    }

    const preview = await api.fetch('/api/instance-settings/apply', { method: 'POST', headers: auth, body: JSON.stringify({ ...body, dry_run: true }) })
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({ dry_run: true, summary: '1 setting would change' })
    const [still] = await sql`select allowed_email_domains from sign_in_method where row_id = 'google'`
    expect(still.allowed_email_domains).toBeNull()

    const applied = await api.fetch('/api/instance-settings/apply', { method: 'POST', headers: auth, body: JSON.stringify(body) })
    expect(applied.status).toBe(200)
    expect(await applied.json()).toMatchObject({
      dry_run: false,
      changes: [{ table: 'Sign In Method', row_id: 'google', field: 'allowed_email_domains', old: null, new: DOMAINS }],
    })
    const [log] = await sql`select full_name from activity_log where "user" = ${INSTANCE_SETTINGS_ACTOR} order by created_at desc limit 1`
    expect(log.full_name).toBe(`instance settings file, applied by ${bot.row_id}`)

    const exported = await api.fetch('/api/instance-settings/export', { headers: auth })
    expect(exported.status).toBe(200)
    expect(((await exported.json()) as { file: InstanceSettingsFile }).file.settings['Sign In Method']).toContainEqual(expect.objectContaining({ row_id: 'google', allowed_email_domains: DOMAINS }))

    const clerk = await makePerson({ full_name: 'Clerk', email: 'clerk.settings@example.com' })
    const { token: clerkToken } = await issueAccessToken(clerk, 'clerk', null)
    for (const [path, init] of [
      ['/api/instance-settings/apply', { method: 'POST', body: JSON.stringify(body) }],
      ['/api/instance-settings/export', {}],
    ] as const) {
      const refused = await api.fetch(path, { ...init, headers: { authorization: `Bearer ${clerkToken}` } })
      expect(refused.status).toBe(403)
    }
    const [unchanged] = await sql`select count(*)::int as n from activity_log where full_name = ${`instance settings file, applied by ${clerk}`}`
    expect(unchanged.n).toBe(0)
  })

  test('a malformed request is refused with the reason', async ({ admin }) => {
    const res = await admin.fetch('/api/instance-settings/apply', { method: 'POST', body: JSON.stringify({ file: { settings: {} , extra: 1 } }) })
    expect(res.status).toBe(417)
    expect(await res.text()).toContain('extra')
  })
})

describe('an environment section adds to the base', () => {
  const row = (row_id: string, label: string) => ({ row_id, kind: 'delegated_password', label, enabled: false, service_url: 'https://hr.example.com/login' })

  test('rows only the section names are added, a row it shares with the base takes the section\'s fields, and the rest of the base stays', async () => {
    const file: InstanceSettingsFile = {
      settings: { 'Sign In Method': [row('base_one', 'Base one')], 'System Settings': { app_name: 'Base Name', session_hours: 8 } },
      environments: {
        dev: {
          settings: {
            'Sign In Method': [{ row_id: 'base_one', label: 'Base one (dev)' }, row('dev_only', 'Dev only')],
            'System Settings': { app_name: 'Dev Name' },
            'Scheduled Job': [{ row_id: 'disable_leavers', enabled: false }],
          },
        },
      },
    }
    await applyInstanceSettings(file, { by: 'Administrator', environment: 'dev' })
    const methods = await sql`select row_id, label from sign_in_method where row_id in ('base_one', 'dev_only') order by row_id`
    expect(methods).toEqual([{ row_id: 'base_one', label: 'Base one (dev)' }, { row_id: 'dev_only', label: 'Dev only' }])
    const stored = Object.fromEntries((await sql`select field, value from single_value where table_name = 'System Settings' and field in ('app_name', 'session_hours')`).map((r) => [r.field, r.value]))
    expect({ app_name: stored.app_name, session_hours: Number(stored.session_hours) }).toEqual({ app_name: 'Dev Name', session_hours: 8 })
  })
})

describe('the shape of each Table in the file', () => {
  test('a Settings Table given a list, or a row Table given an object, is refused naming the shape it takes', async () => {
    const err = await problemsOf(applyInstanceSettings({ settings: { 'System Settings': [{ row_id: 'x' }], 'Sign In Method': { label: 'x' } } }, { by: 'Administrator' }))
    expect(err.fields).toMatchObject({
      'System Settings': 'System Settings takes one object of fields',
      'Sign In Method': 'Sign In Method takes a list of rows, each with a row_id',
    })
  })
})

describe('a refusal that names no field', () => {
  test('is reported against the row, in the refusal\'s own words, and nothing is saved', async () => {
    const before = await snapshot()
    const err = await problemsOf(applyInstanceSettings({
      settings: { 'Sign In Method': [{ row_id: 'second_google', kind: 'google', label: 'Second Google', enabled: false }] },
    }, { by: 'Administrator' }))
    expect(err.fields).toEqual({ 'Sign In Method.second_google': expect.stringContaining('already a google sign-in method') })
    expect(await snapshot()).toEqual(before)
  })
})

describe('settings that differ from the file', () => {
  test('a value changed outside the file is reported as drift, by Table, row and field', async () => {
    const { settingsDrift } = await import('../src/instance-settings')
    await applyInstanceSettings({ settings: { 'System Settings': { app_name: 'Filed Name' } } }, { by: 'Administrator' })
    expect(await settingsDrift()).toEqual([])
    await sql`update single_value set value = 'Edited Elsewhere' where table_name = 'System Settings' and field = 'app_name'`
    expect(await settingsDrift()).toEqual([{ table: 'System Settings', row_id: 'System Settings', field: 'app_name' }])
  })
})

describe('export reads text that only looks like JSON', () => {
  test('a JSON setting holding text that is not JSON is exported as that text, and braces in ordinary prose are not a secret', async () => {
    await sql`insert into single_value (table_name, field, value) values ('System Settings', 'people_review', 'not json')
      on conflict (table_name, field) do update set value = excluded.value`
    await sql`insert into single_value (table_name, field, value) values ('System Settings', 'invitation_email_intro', '{ welcome to the shop')
      on conflict (table_name, field) do update set value = excluded.value`
    const exported = await exportInstanceSettings()
    expect(exported.file.settings['System Settings']).toMatchObject({ people_review: 'not json', invitation_email_intro: '{ welcome to the shop' })
    expect(exported.withheld).toEqual([])
  })
})

describe('a managed row\'s fields are compared too', () => {
  test('a sign-in method field changed outside the file is reported as drift on that row', async () => {
    const { settingsDrift } = await import('../src/instance-settings')
    await applyInstanceSettings({ settings: { 'Sign In Method': [{ row_id: 'google', allowed_email_domains: DOMAINS }] } }, { by: 'Administrator' })
    expect(await settingsDrift()).toEqual([])
    await sql`update sign_in_method set allowed_email_domains = 'edited.example' where row_id = 'google'`
    expect(await settingsDrift()).toEqual([{ table: 'Sign In Method', row_id: 'google', field: 'allowed_email_domains' }])
  })
})

describe('a decimal setting', () => {
  test('is applied as a number, a value of another type is refused naming the field, and export gives the number back', async () => {
    await sql`insert into column_def ${sql({ parent: 'System Settings', position: 996, column_name: 'rate_test', label: null,
      column_type: 'Float', reqd: false, unique: false, default_value: null, read_only: false, hidden: false, in_list_view: false, tier: 'basic' })}`
    const { invalidateMeta } = await import('../src/meta')
    invalidateMeta('System Settings')
    try {
      const refused = await problemsOf(applyInstanceSettings({ settings: { 'System Settings': { rate_test: '2.5' } } }, { by: 'Administrator' }))
      expect(JSON.stringify(refused.fields)).toContain('a number')
      const result = await applyInstanceSettings({ settings: { 'System Settings': { rate_test: 2.5 } } }, { by: 'Administrator' })
      expect(result.changes).toContainEqual(expect.objectContaining({ field: 'rate_test', old: null, new: 2.5 }))
      expect((await exportInstanceSettings()).file.settings['System Settings']).toMatchObject({ rate_test: 2.5 })
      expect((await applyInstanceSettings({ settings: { 'System Settings': { rate_test: 2.5 } } }, { by: 'Administrator' })).changes).toEqual([])
    } finally {
      await sql`delete from column_def where parent = 'System Settings' and column_name = 'rate_test'`
      invalidateMeta('System Settings')
    }
  })
})

describe('values from variables (#703)', () => {
  const file = (name: unknown) => ({ settings: { 'System Settings': { app_name: { env: name } } } }) as unknown as InstanceSettingsFile

  test('a value is read, saved, locked, and never shown', async () => {
    const secretLooking = 'made-up-value-40417'
    const result = await applyInstanceSettings(file('SOME_NAME'), { by: 'Administrator', env: { SOME_NAME: secretLooking } })
    expect(result.changes).toEqual([expect.objectContaining({ field: 'app_name', from_variable: 'SOME_NAME', old: null, new: null })])
    expect(JSON.stringify(result)).not.toContain(secretLooking)
    const [stored] = await sql`select value from single_value where table_name = 'System Settings' and field = 'app_name'`
    expect(stored.value).toBe(secretLooking)
    await expect(saveDoc('System Settings', { app_name: 'By hand' }, 'Administrator')).rejects.toThrow(/settings file/)
    expect(JSON.stringify(await settingsDrift())).not.toContain(secretLooking)
    // Unchanged on a second apply, and a dry run shows nothing either.
    expect((await applyInstanceSettings(file('SOME_NAME'), { by: 'Administrator', env: { SOME_NAME: secretLooking } })).changes).toEqual([])
    const preview = await applyInstanceSettings(file('SOME_NAME'), { by: 'Administrator', dryRun: true, env: { SOME_NAME: 'made-up-other-71' } })
    expect(preview.changes).toHaveLength(1)
    expect(JSON.stringify(preview)).not.toMatch(/made-up-(other|value)/)
  })

  test.each([[undefined], [''], ['   ']])('a variable holding %j is a listed problem naming it, in a dry run too', async (value) => {
    const before = await snapshot()
    const env: Record<string, string> = value === undefined ? {} : { MISSING_NAME: value }
    for (const dryRun of [false, true]) {
      const err = await problemsOf(applyInstanceSettings(file('MISSING_NAME'), { by: 'Administrator', dryRun, env }))
      expect(err.fields).toMatchObject({ 'System Settings.app_name': expect.stringContaining('MISSING_NAME') })
    }
    expect(await snapshot()).toEqual(before)
  })

  test('the server never reads its own environment for a file', async () => {
    vi.stubEnv('ONLY_ON_THE_SERVER', 'server-side-value')
    const err = await problemsOf(applyInstanceSettings(file('ONLY_ON_THE_SERVER'), { by: 'Administrator' }))
    expect(err.message).toContain('ONLY_ON_THE_SERVER')
    expect(err.message).not.toContain('server-side-value')
  })

  test('a secret variable and a malformed name are refused', async () => {
    const secret = await problemsOf(applyInstanceSettings(file('DATABASE_URL'), { by: 'Administrator', env: { DATABASE_URL: 'x' } }))
    expect(secret.message).toContain('holds a secret')
    const bad = await problemsOf(applyInstanceSettings(file(5), { by: 'Administrator' }))
    expect(bad.message).toContain('must be a variable name')
  })

  test('a value in the wrong type is refused without being quoted', async () => {
    const err = await problemsOf(applyInstanceSettings({ settings: { 'Scheduled Job': [{ row_id: 'check_sla', enabled: { env: 'SWITCH' } }] } } as unknown as InstanceSettingsFile,
      { by: 'Administrator', env: { SWITCH: 'made-up-not-a-switch' } }))
    expect(err.message).toContain('SWITCH')
    expect(err.message).not.toContain('made-up-not-a-switch')
  })

  test('a save that quotes the refused value has it taken out', async () => {
    const err = await problemsOf(applyInstanceSettings({ settings: { 'Sign In Method': [{ row_id: 'google', allowed_email_domains: { env: 'DOMAINS' } }] } } as unknown as InstanceSettingsFile,
      { by: 'Administrator', env: { DOMAINS: 'exam ple.com' } }))
    expect(err.message).toContain('[the value of DOMAINS]')
    expect(err.message).not.toContain('exam ple.com')
  })

  test('an app setting for an app not yet installed is a listed problem', async () => {
    const err = await problemsOf(applyInstanceSettings({ settings: { 'App Setting': [{ row_id: 'not_installed.dive_id', value: { env: 'DIVE' } }] } } as unknown as InstanceSettingsFile,
      { by: 'Administrator', env: { DIVE: 'made-up-dive-9' } }))
    expect(err.message).toContain('App not_installed is not installed')
    expect(err.message).not.toContain('made-up-dive-9')
  })
})

describe('Data Source rows (#703)', () => {
  const source = { row_id: 'made-up-warehouse', engine: 'postgres', url_env: 'MADE_UP_WAREHOUSE_URL', access: 'read_only' }

  test('a row comes back from the file, and is locked', async () => {
    const result = await applyInstanceSettings({ settings: { 'Data Source': [source] } }, { by: 'Administrator' })
    expect(result.changes.some((c) => c.table === 'Data Source' && c.field === 'url_env' && c.created)).toBe(true)
    const [row] = await sql`select engine, url_env, access from data_source where row_id = ${source.row_id}`
    expect(row).toMatchObject({ engine: 'postgres', url_env: 'MADE_UP_WAREHOUSE_URL', access: 'read_only' })
    const [current] = await sql`select updated_at from data_source where row_id = ${source.row_id}`
    await expect(saveDoc('Data Source', { row_id: source.row_id, url_env: 'OTHER', updated_at: current.updated_at }, 'Administrator')).rejects.toThrow(/settings file/)
    expect((await applyInstanceSettings({ settings: { 'Data Source': [source] } }, { by: 'Administrator' })).changes).toEqual([])
  })

  test('a connection string is refused, and not repeated', async () => {
    const err = await problemsOf(applyInstanceSettings({ settings: { 'Data Source': [{ ...source, url_env: 'postgres://u:made-up-pw@db/x' }] } }, { by: 'Administrator' }))
    expect(err.message).toContain('url_env must be a variable NAME')
    expect(err.message).not.toContain('made-up-pw')
  })

  test('the connection status stays the server\'s', async () => {
    const err = await problemsOf(applyInstanceSettings({ settings: { 'Data Source': [{ ...source, conn_status: 'ok' }] } }, { by: 'Administrator' }))
    expect(err.message).toContain('is not managed by the settings file')
  })
})
