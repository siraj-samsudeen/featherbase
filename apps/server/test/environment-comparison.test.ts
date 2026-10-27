// Comparing environments (#465, design D10; spec instance-health "Compare
// environments without revealing secrets"). Each environment answers a
// variable report for a key the caller picks for the run: which declared
// variables are set, a keyed fingerprint for the secrets with a
// cross-environment rule, and where its settings stand against the file. The
// comparison puts two or more reports side by side and names every broken
// rule. No value is ever returned or kept.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { issueAccessToken } from '../src/auth'
import { createServiceAccount } from '../src/service-accounts'
import { applyInstanceSettings } from '../src/instance-settings'
import {
  compareEnvironments,
  fingerprint,
  formatComparison,
  variableReport,
  type VariableReport,
} from '../src/environment-comparison'
import { main } from '../src/cli'
import { runMain } from './command-io'
import { makePerson } from './fixtures'

afterEach(() => vi.unstubAllEnvs())

const KEY = 'k'.repeat(16) + 'e'.repeat(16) + 'y'.repeat(16)
const OTHER_KEY = 'o'.repeat(48)
const JWT = 'a-long-random-secret-that-must-never-be-printed'
const DB = 'postgres://user:hunter2-password@db.internal:5432/featherbase'

function entry(report: VariableReport, name: string) {
  const found = report.variables.find((v) => v.name === name)
  expect(found, name).toBeDefined()
  return found!
}

/** One environment's report: the variables stubbed as given, every other
 *  rule-bearing secret cleared so the reports differ only where a test says. */
async function environment(vars: Record<string, string>, key = KEY): Promise<VariableReport> {
  return { ...(await unapplied(vars, key)), settings: APPLIED }
}

/** Both environments applied from one revision, unchanged since. */
const APPLIED: VariableReport['settings'] = { applied: true, environment: null, revision: 'a'.repeat(40), matches_file: true }

async function unapplied(vars: Record<string, string>, key = KEY): Promise<VariableReport> {
  const base = { DATABASE_URL: '', JWT_SECRET: '', FILE_URL_SECRET: '', GOOGLE_CLIENT_SECRET: '', SMTP_HOST: '', INSTANCE_ADDRESSES: '' }
  for (const [k, v] of Object.entries({ ...base, ...vars })) vi.stubEnv(k, v)
  try {
    return await variableReport(key)
  } finally {
    vi.unstubAllEnvs()
  }
}

describe('fingerprints', () => {
  test('the same value gives a different fingerprint under another key, and the same one under the same key', () => {
    const a = fingerprint(KEY, JWT)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(fingerprint(KEY, JWT)).toBe(a)
    expect(fingerprint(OTHER_KEY, JWT)).not.toBe(a)
    expect(fingerprint(KEY, `${JWT}x`)).not.toBe(a)
  })
})

describe('the variable report', () => {
  test('says what is set, fingerprints only the rule-bearing secrets, and holds no value', async () => {
    vi.stubEnv('JWT_SECRET', JWT)
    vi.stubEnv('DATABASE_URL', DB)
    vi.stubEnv('SMTP_PASSWORD', 'smtp-app-password-value')
    vi.stubEnv('INSTANCE_ADDRESSES', '[{"address":"https://dev.example.test","opens":"admin","emails":true}]')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    const report = await variableReport(KEY)
    const text = JSON.stringify(report)
    for (const value of [JWT, DB, 'hunter2', 'smtp-app-password-value', 'dev.example.test', KEY]) expect(text).not.toContain(value)

    expect(entry(report, 'JWT_SECRET')).toMatchObject({ set: true, secret: true, rule: 'must-differ', fingerprint: fingerprint(KEY, JWT) })
    expect(entry(report, 'DATABASE_URL')).toMatchObject({ set: true, rule: 'must-differ', fingerprint: fingerprint(KEY, DB) })
    // A secret with no rule, and a plain variable, are reported by presence only.
    expect(entry(report, 'SMTP_PASSWORD')).toEqual({ name: 'SMTP_PASSWORD', secret: true, presence: 'optional', set: true })
    expect(entry(report, 'INSTANCE_ADDRESSES')).toEqual({ name: 'INSTANCE_ADDRESSES', secret: false, presence: 'required', set: true })
    // Unset (or blank) is unset, and has nothing to fingerprint.
    expect(entry(report, 'GOOGLE_CLIENT_SECRET')).toEqual({ name: 'GOOGLE_CLIENT_SECRET', secret: true, presence: 'optional', set: false, rule: 'must-match' })
    expect(report.environment).toBe('test')
    expect(report.key_id).toMatch(/^[0-9a-f]{8}$/)
  })

  test('a variable a feature needs counts as required while the feature is on', async () => {
    await sql`update sign_in_method set enabled = true, client_id = 'client.apps.example' where row_id = 'google'`
    const report = await environment({})
    expect(entry(report, 'GOOGLE_CLIENT_SECRET').presence).toBe('required')
  })

  test('a variable a data source names is reported, by presence', async () => {
    await sql`insert into data_source (row_id, engine, url_env) values ('warehouse', 'postgres', 'WAREHOUSE_TEST_URL')`
    vi.stubEnv('WAREHOUSE_TEST_URL', 'postgres://w:secret@warehouse/db')
    const report = await variableReport(KEY)
    expect(entry(report, 'WAREHOUSE_TEST_URL')).toEqual({ name: 'WAREHOUSE_TEST_URL', secret: true, presence: 'recommended', set: true })
    expect(JSON.stringify(report)).not.toContain('warehouse/db')
  })

  test('says which file revision was last applied, and whether the settings still match it', async () => {
    expect((await variableReport(KEY)).settings).toEqual({ applied: false, environment: null, revision: null, matches_file: null })
    await applyInstanceSettings(
      { settings: { 'System Settings': { app_name: 'Comparison Test' } } },
      { by: 'Administrator', environment: undefined, source: { revision: 'b'.repeat(40) } },
    )
    expect((await variableReport(KEY)).settings).toEqual({ applied: true, environment: null, revision: 'b'.repeat(40), matches_file: true })
    await sql`update single_value set value = 'Changed by hand' where table_name = 'System Settings' and field = 'app_name'`
    expect((await variableReport(KEY)).settings.matches_file).toBe(false)
  })

  test('refuses a key too short to keep fingerprints from being guessed', async () => {
    await expect(variableReport('short')).rejects.toThrow('at least 32 characters')
  })
})

describe('over HTTP', () => {
  test('a System Manager token gets the report for its key; the answer is never cached', async ({ api }) => {
    vi.stubEnv('JWT_SECRET', JWT)
    const bot = await createServiceAccount('compare-bot', ['System Manager'], 'Administrator')
    const { token } = await issueAccessToken(bot.row_id, 'environment comparison', null)
    const headers = { authorization: `Bearer ${token}` }
    const ask = (key: unknown) => api.fetch('/api/instance-settings/variables', { method: 'POST', headers, body: JSON.stringify({ key }) })

    const first = await ask(KEY)
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    const text = await first.text()
    expect(text).not.toContain(JWT)
    const second = (await (await ask(OTHER_KEY)).json()) as VariableReport
    const one = entry(JSON.parse(text) as VariableReport, 'JWT_SECRET').fingerprint
    expect(one).toBe(fingerprint(KEY, JWT))
    expect(entry(second, 'JWT_SECRET').fingerprint).toBe(fingerprint(OTHER_KEY, JWT))
    expect(one).not.toBe(entry(second, 'JWT_SECRET').fingerprint)

    const short = await ask('short')
    expect(short.status).toBe(417)
    expect(await short.text()).toContain('at least 32 characters')
    expect((await ask(undefined)).status).toBe(417)
  })

  test('anyone who is not a System Manager is refused', async ({ api }) => {
    const clerk = await makePerson({ full_name: 'Clerk', email: 'clerk.compare@example.com' })
    const { token } = await issueAccessToken(clerk, 'clerk', null)
    const res = await api.fetch('/api/instance-settings/variables', {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ key: KEY }),
    })
    expect(res.status).toBe(403)
    expect((await api.fetch('/api/instance-settings/variables', { method: 'POST', body: JSON.stringify({ key: KEY }) })).status).toBe(401)
  })
})

describe('the comparison', () => {
  const ADDRESSES = '[{"address":"https://prod.example.test","opens":"admin","emails":true}]'

  test('a session-signing secret shared by dev and prod is a problem, without showing it', async () => {
    const dev = await environment({ JWT_SECRET: JWT })
    const prod = await environment({ JWT_SECRET: JWT })
    const result = compareEnvironments([{ label: 'dev', report: dev }, { label: 'prod', report: prod }])
    const row = result.rows.find((r) => r.name === 'JWT_SECRET')!
    expect(row).toMatchObject({ verdict: 'problem', reason: 'the same on dev and prod; it must differ between environments' })
    expect(result.problems).toBeGreaterThanOrEqual(1)
    expect(formatComparison(result)).not.toContain(JWT)

    const apart = compareEnvironments([{ label: 'dev', report: await environment({ JWT_SECRET: `${JWT}-dev` }) }, { label: 'prod', report: prod }])
    expect(apart.rows.find((r) => r.name === 'JWT_SECRET')).toMatchObject({ verdict: 'ok' })
  })

  test('a secret that must match and does not is a problem', async () => {
    const dev = await environment({ GOOGLE_CLIENT_SECRET: 'google-secret-one' })
    const prod = await environment({ GOOGLE_CLIENT_SECRET: 'google-secret-two' })
    const row = compareEnvironments([{ label: 'dev', report: dev }, { label: 'prod', report: prod }]).rows.find((r) => r.name === 'GOOGLE_CLIENT_SECRET')
    expect(row).toMatchObject({ verdict: 'problem', reason: 'differs between dev and prod; it must be the same in every environment' })
    const same = await environment({ GOOGLE_CLIENT_SECRET: 'google-secret-two' })
    expect(compareEnvironments([{ label: 'dev', report: same }, { label: 'prod', report: prod }]).rows.find((r) => r.name === 'GOOGLE_CLIENT_SECRET')).toMatchObject({ verdict: 'ok' })
  })

  test('a required variable set on one environment only is a problem; an optional one is a note', async () => {
    const dev = await environment({})
    const prod = await environment({ INSTANCE_ADDRESSES: ADDRESSES, SMTP_HOST: 'smtp-relay.example.test' })
    const result = compareEnvironments([{ label: 'dev', report: dev }, { label: 'prod', report: prod }])
    expect(result.rows.find((r) => r.name === 'INSTANCE_ADDRESSES')).toMatchObject({ verdict: 'problem', reason: 'set on prod only', values: { dev: 'unset', prod: 'set' } })
    expect(result.rows.find((r) => r.name === 'SMTP_HOST')).toMatchObject({ verdict: 'note', reason: 'set on prod only' })
    // A variable no environment sets is left out of the table.
    expect(result.rows.find((r) => r.name === 'CHROMIUM_PATH')).toBeUndefined()
  })

  test('environments on different file revisions, or changed outside the file, are a problem', async () => {
    const dev = await environment({})
    const prod = await environment({})
    const at = (settings: VariableReport['settings']): VariableReport => ({ ...dev, settings })
    const applied = { applied: true, environment: 'dev', revision: 'a'.repeat(40), matches_file: true }
    const same = compareEnvironments([{ label: 'dev', report: at(applied) }, { label: 'prod', report: { ...prod, settings: { ...applied, environment: 'prod' } } }])
    expect(same.rows.filter((r) => r.kind === 'settings')).toEqual([
      { kind: 'settings', name: 'Settings file revision', values: { dev: 'aaaaaaaaaaaa', prod: 'aaaaaaaaaaaa' }, verdict: 'ok', reason: '' },
      { kind: 'settings', name: 'Settings match the file', values: { dev: 'yes', prod: 'yes' }, verdict: 'ok', reason: '' },
    ])

    const apart = compareEnvironments([
      { label: 'dev', report: at({ applied: false, environment: null, revision: null, matches_file: null }) },
      { label: 'prod', report: { ...prod, settings: { ...applied, matches_file: false } } },
    ])
    expect(apart.rows.filter((r) => r.kind === 'settings')).toEqual([
      { kind: 'settings', name: 'Settings file revision', values: { dev: 'never applied', prod: 'aaaaaaaaaaaa' }, verdict: 'problem', reason: 'never applied on dev' },
      { kind: 'settings', name: 'Settings match the file', values: { dev: 'not applied', prod: 'no' }, verdict: 'problem', reason: 'changed outside the file on prod' },
    ])
    const revisions = compareEnvironments([
      { label: 'dev', report: at(applied) },
      { label: 'prod', report: { ...prod, settings: { ...applied, revision: 'c'.repeat(40) } } },
    ])
    expect(revisions.rows.find((r) => r.name === 'Settings file revision')).toMatchObject({ verdict: 'problem', reason: 'dev and prod were applied from different revisions' })
  })

  test('reports made with different keys cannot be compared', async () => {
    const dev = await environment({}, KEY)
    const prod = await environment({}, OTHER_KEY)
    expect(() => compareEnvironments([{ label: 'dev', report: dev }, { label: 'prod', report: prod }])).toThrow('different keys')
    expect(() => compareEnvironments([{ label: 'dev', report: dev }])).toThrow('at least two')
    expect(() => compareEnvironments([{ label: 'dev', report: dev }, { label: 'dev', report: dev }])).toThrow('twice')
  })

  test('the table puts the environments side by side and ends with the count', async () => {
    const dev = await environment({ JWT_SECRET: JWT })
    const prod = await environment({ JWT_SECRET: JWT, INSTANCE_ADDRESSES: ADDRESSES })
    const table = formatComparison(compareEnvironments([{ label: 'dev', report: dev }, { label: 'prod', report: prod }]))
    const lines = table.split('\n')
    expect(lines[0]).toMatch(/^Variable\s+dev\s+prod\s+Result$/)
    expect(lines.find((l) => l.startsWith('JWT_SECRET'))).toMatch(/^JWT_SECRET\s+set\s+set\s+PROBLEM: the same on dev and prod; it must differ between environments$/)
    expect(lines.find((l) => l.startsWith('INSTANCE_ADDRESSES'))).toMatch(/unset\s+set\s+PROBLEM: set on prod only$/)
    expect(lines.at(-1)).toMatch(/^\d+ problems?(, \d+ notes?)?\.$/)
    expect(table).not.toContain(JWT)

    const clean = formatComparison(compareEnvironments([{ label: 'dev', report: await environment({}) }, { label: 'prod', report: await environment({}) }]))
    expect(clean.split('\n').at(-1)).toBe('No problems.')
  })
})

describe('on the command line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'featherbase-compare-cli-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('settings:variables prints this environment\'s report for a key read from stdin', async () => {
    vi.stubEnv('JWT_SECRET', JWT)
    const r = await runMain(main, ['settings:variables', '--stdin'], `${KEY}\n`)
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain(JWT)
    expect(entry(JSON.parse(r.stdout) as VariableReport, 'JWT_SECRET').fingerprint).toBe(fingerprint(KEY, JWT))
    const usage = await runMain(main, ['settings:variables'], KEY)
    expect(usage.code).toBe(1)
    expect(usage.stderr).toContain('usage: cli settings:variables --stdin')
  })

  test('settings:compare prints the table and fails while a rule is broken', async () => {
    const write = (name: string, report: VariableReport) => {
      const file = join(dir, name)
      writeFileSync(file, JSON.stringify(report))
      return file
    }
    const dev = write('dev.json', await environment({ JWT_SECRET: JWT }))
    const prod = write('prod.json', await environment({ JWT_SECRET: JWT }))
    const broken = await runMain(main, ['settings:compare', `dev=${dev}`, `prod=${prod}`])
    expect(broken.code).toBe(1)
    expect(broken.stdout).toMatch(/JWT_SECRET\s+set\s+set\s+PROBLEM/)
    expect(broken.stdout).not.toContain(JWT)

    const fixed = write('dev-fixed.json', await environment({ JWT_SECRET: `${JWT}-dev` }))
    const ok = await runMain(main, ['settings:compare', `dev=${fixed}`, `prod=${prod}`])
    expect(ok.code).toBe(0)
    expect(ok.stdout.trim().split('\n').at(-1)).toBe('No problems.')

    const usage = await runMain(main, ['settings:compare', dev])
    expect(usage.code).toBe(1)
    expect(usage.stderr).toContain('usage: cli settings:compare <label>=<report.json> <label>=<report.json> [...]')
    const unreadable = await runMain(main, ['settings:compare', `dev=${dev}`, `prod=${join(dir, 'missing.json')}`])
    expect(unreadable.code).toBe(1)
    expect(unreadable.stderr).toContain('cannot read')
  })
})
