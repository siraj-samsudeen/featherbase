// The deployment-variable registry (instance-settings-as-code D6/D7, #465).
// Pure: no database. The release-preflight and server-start wiring is tested
// in release-preflight.test.ts and server-start.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertServerStart, assertVariables, checkVariables, isSet, VARIABLES } from '../src/env'
import { config } from '../src/config'

afterEach(() => vi.unstubAllEnvs())

// A production environment with everything it requires, and none of the
// switches production must never have (the suite itself runs with
// ALLOW_MOCK_OAUTH=1, vitest.config.ts).
function production(extra: Record<string, string> = {}) {
  const base: Record<string, string> = {
    DATABASE_URL: 'postgres://u:p@db.internal:5432/featherbase',
    JWT_SECRET: 'a-long-random-production-secret',
    INSTANCE_ADDRESSES: '[{"address":"https://app.example.test","opens":"admin","emails":true}]',
    FILE_STORAGE_DIR: '/data/files',
    ALLOW_MOCK_OAUTH: '',
    DELEGATED_LOGIN_TEST_MODE: '',
    PREVIEW_LOGIN_KEY: '',
    PREVIEW_LOGIN_USER: '',
  }
  for (const [k, v] of Object.entries({ ...base, ...extra })) vi.stubEnv(k, v)
}

describe('the registry', () => {
  it('declares each variable once, with a purpose', () => {
    const names = VARIABLES.map((v) => v.name)
    expect(new Set(names).size).toBe(names.length)
    for (const v of VARIABLES) expect(v.purpose.length, v.name).toBeGreaterThan(10)
  })

  it('marks the secrets, and gives the rule-bearing ones a cross-environment rule', () => {
    const secret = (n: string) => VARIABLES.find((v) => v.name === n)!.secret
    expect(['JWT_SECRET', 'DATABASE_URL', 'GOOGLE_CLIENT_SECRET', 'SMTP_PASSWORD', 'MOTHERDUCK_TOKEN', 'PREVIEW_LOGIN_KEY'].every(secret)).toBe(true)
    expect(['INSTANCE_ADDRESSES', 'FILE_STORAGE_DIR', 'SMTP_HOST'].some(secret)).toBe(false)
    const rule = (n: string) => (VARIABLES.find((v) => v.name === n) as { crossEnvironment?: string }).crossEnvironment
    expect(rule('JWT_SECRET')).toBe('must-differ')
    expect(rule('FILE_URL_SECRET')).toBe('must-differ')
    expect(rule('GOOGLE_CLIENT_SECRET')).toBe('must-match')
  })
})

describe('required variables', () => {
  it('a complete production environment passes', () => {
    production()
    const report = checkVariables({ environment: 'production' })
    expect(report.forbidden).toEqual([])
    expect(report.refusals).toEqual([])
    expect(report.warnings).toEqual([])
    expect(report.passed).toEqual(expect.arrayContaining(['JWT_SECRET set', 'INSTANCE_ADDRESSES set', 'DATABASE_URL set']))
  })

  it('a missing JWT_SECRET refuses outside development and test, naming it', () => {
    production({ JWT_SECRET: '' })
    expect(() => assertVariables({ environment: 'production' })).toThrow(/JWT_SECRET is not set on a "production" server/)
    expect(() => assertVariables({ environment: 'staging' })).toThrow(/JWT_SECRET is not set on a "staging" server/)
  })

  it('development and test pass without it: their defaults are for a checkout', () => {
    production({ JWT_SECRET: '', DATABASE_URL: '', INSTANCE_ADDRESSES: '' })
    for (const environment of ['development', 'test'])
      expect(assertVariables({ environment })).toEqual(expect.arrayContaining([`JWT_SECRET unset, allowed on a "${environment}" server`]))
  })

  it('an empty or whitespace-only value counts as missing', () => {
    production({ JWT_SECRET: '   ' })
    expect(isSet('JWT_SECRET')).toBe(false)
    expect(checkVariables({ environment: 'production' }).refusals).toEqual([expect.stringMatching(/^JWT_SECRET is not set/)])
  })

  it('a dev default is not "set": DATABASE_URL unset refuses though config has a local default', () => {
    production()
    delete process.env.DATABASE_URL
    expect(config.databaseUrl).toMatch(/^postgres:\/\//)
    expect(checkVariables({ environment: 'production' }).refusals).toEqual([expect.stringMatching(/^DATABASE_URL is not set on a "production" server/)])
  })

  it('reads at call time: a variable set after import is seen', () => {
    production({ INSTANCE_ADDRESSES: '' })
    expect(checkVariables({ environment: 'production' }).refusals.join()).toMatch(/INSTANCE_ADDRESSES/)
    vi.stubEnv('INSTANCE_ADDRESSES', '[{"address":"https://later.example.test","opens":"admin","emails":true}]')
    expect(checkVariables({ environment: 'production' }).refusals).toEqual([])
  })

  it('every refusal is named at once', () => {
    production({ JWT_SECRET: '', INSTANCE_ADDRESSES: '' })
    expect(() => assertVariables({ environment: 'production' })).toThrow(/INSTANCE_ADDRESSES is not set[\s\S]*JWT_SECRET is not set/)
  })
})

describe('recommended variables', () => {
  it('a missing FILE_STORAGE_DIR warns and lets the release go ahead', () => {
    production({ FILE_STORAGE_DIR: '' })
    const lines = assertVariables({ environment: 'production' })
    expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(/^WARNING: FILE_STORAGE_DIR is not set on a "production" server\..*vanish/)]))
  })

  it('does not warn in development', () => {
    production({ FILE_STORAGE_DIR: '' })
    expect(checkVariables({ environment: 'development' }).warnings).toEqual([])
  })
})

describe('switches production must never have', () => {
  it('the mock Google provider is allowed only in development and test, not on a hosted staging trial', () => {
    production({ ALLOW_MOCK_OAUTH: '1' })
    expect(() => assertVariables({ environment: 'production' })).toThrow(/^ALLOW_MOCK_OAUTH is set on a "production" server/)
    expect(() => assertVariables({ environment: 'staging' })).toThrow(/^ALLOW_MOCK_OAUTH is set on a "staging" server/)
    for (const environment of ['development', 'test'])
      expect(assertVariables({ environment })).toContain(`ALLOW_MOCK_OAUTH on, allowed on a "${environment}" server`)
  })

  it.each([
    ['DELEGATED_LOGIN_TEST_MODE', 'trust-any-password'],
    ['PREVIEW_LOGIN_KEY', 'k'.repeat(40)],
    ['PREVIEW_LOGIN_USER', 'preview@example.test'],
  ])('%s on refuses in production, and is allowed in development, test and staging', (name, value) => {
    production({ [name]: value })
    expect(() => assertVariables({ environment: 'production' })).toThrow(new RegExp(`^${name} is set on a "production" server`))
    for (const environment of ['development', 'test', 'staging'])
      expect(assertVariables({ environment })).toContain(`${name} on, allowed on a "${environment}" server`)
  })

  it('a value that does not switch the feature on is not refused', () => {
    // mockOAuthEnabled() needs exactly "1"; test mode needs the exact phrase.
    production({ ALLOW_MOCK_OAUTH: '0', DELEGATED_LOGIN_TEST_MODE: '1' })
    expect(checkVariables({ environment: 'production' }).forbidden).toEqual([])
  })

  it('comes first among the refusals: it is the security finding', () => {
    production({ JWT_SECRET: '', ALLOW_MOCK_OAUTH: '1' })
    expect(() => assertVariables({ environment: 'production' })).toThrow(/^ALLOW_MOCK_OAUTH is set[^\n]*\nJWT_SECRET is not set/)
  })
})

describe('settings-dependent requirements', () => {
  it('Google sign-in enabled makes GOOGLE_CLIENT_SECRET required', () => {
    production({ GOOGLE_CLIENT_SECRET: '' })
    expect(checkVariables({ environment: 'production' }).refusals).toEqual([])
    const on = new Set(['google-sign-in-enabled'] as const)
    expect(() => assertVariables({ environment: 'production', conditions: on })).toThrow(/GOOGLE_CLIENT_SECRET is not set on a "production" server\. \(required while a Google sign-in method is enabled/)
    expect(checkVariables({ environment: 'development', conditions: on }).warnings).toEqual([expect.stringMatching(/^WARNING: GOOGLE_CLIENT_SECRET/)])
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'set')
    expect(assertVariables({ environment: 'production', conditions: on })).toContain('GOOGLE_CLIENT_SECRET set')
  })

  it('a variable the data names only warns when missing, and on a developer\'s machine says nothing', () => {
    production()
    const named = [{ name: 'FB_TEST_WAREHOUSE_URL', reason: 'the url_env of data source warehouse' }]
    const local = checkVariables({ environment: 'development', named })
    expect(local.warnings).toEqual([])
    expect(local.passed).toContain('FB_TEST_WAREHOUSE_URL unset, allowed on a "development" server (the url_env of data source warehouse)')
    for (const environment of ['production', 'staging', 'test']) {
      const report = checkVariables({ environment, named })
      expect(report.refusals).toEqual([])
      expect(report.warnings).toEqual([expect.stringMatching(new RegExp(`^WARNING: FB_TEST_WAREHOUSE_URL is not set on a "${environment}" server \\(the url_env of data source warehouse\\)\\. That source refuses every query`))])
    }
    expect(() => assertServerStart('production', { named })).not.toThrow()
    vi.stubEnv('FB_TEST_WAREHOUSE_URL', 'postgres://warehouse')
    expect(assertVariables({ environment: 'production', named })).toContain('FB_TEST_WAREHOUSE_URL set (the url_env of data source warehouse)')
  })
})

describe('server start', () => {
  it('refuses on a missing required variable and never reads the settings', () => {
    production({ JWT_SECRET: '' })
    expect(() => assertServerStart('production')).toThrow(/JWT_SECRET is not set/)
    production({ GOOGLE_CLIENT_SECRET: '' })
    expect(() => assertServerStart('production')).not.toThrow()
  })
})

describe('the helpers around the process environment', () => {
  it('withVariable sets a variable for one call, then restores what was there, even when the call throws', async () => {
    const { withVariable, readVariable } = await import('../src/env')
    vi.stubEnv('PREVIEW_LOGIN_USER', 'before')
    await expect(withVariable('PREVIEW_LOGIN_USER', 'during', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(readVariable('PREVIEW_LOGIN_USER')).toBe('before')
    expect(await withVariable('PREVIEW_LOGIN_USER', 'during', async () => readVariable('PREVIEW_LOGIN_USER'))).toBe('during')
    delete process.env.PREVIEW_LOGIN_USER
    await withVariable('PREVIEW_LOGIN_USER', 'during', async () => undefined)
    expect(process.env.PREVIEW_LOGIN_USER).toBeUndefined()
  })

  it('a named variable is read as it is, and a child process environment carries the extras on top', async () => {
    const { readNamedVariable, childEnvironment, processEnvironment } = await import('../src/env')
    vi.stubEnv('SOME_SOURCE_URL_ENV', 'postgres://x')
    expect(readNamedVariable('SOME_SOURCE_URL_ENV')).toBe('postgres://x')
    expect(readNamedVariable('SURELY_NOT_SET_ANYWHERE')).toBeUndefined()
    expect(childEnvironment({ DATABASE_URL: 'postgres://rehearsal' })).toMatchObject({ SOME_SOURCE_URL_ENV: 'postgres://x', DATABASE_URL: 'postgres://rehearsal' })
    expect(childEnvironment().SOME_SOURCE_URL_ENV).toBe('postgres://x')
    expect(processEnvironment()).toBe(process.env)
  })
})

describe('the local .env file', () => {
  it('fills only variables the shell has not set, understands export, quotes and comments, and ignores a file that is absent or unreadable', async () => {
    const { loadDotEnv } = await import('../src/env')
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'dotenv-'))
    const file = join(dir, '.env')
    writeFileSync(file, ['# comment', 'DOTENV_A=plain', 'export DOTENV_B="quoted value"', "DOTENV_C='single'", 'DOTENV_KEPT=from-file', '  # DOTENV_D=hidden', 'not a pair'].join('\n'))
    vi.stubEnv('DOTENV_KEPT', 'from-shell')
    for (const k of ['DOTENV_A', 'DOTENV_B', 'DOTENV_C', 'DOTENV_D']) delete process.env[k]
    try {
      loadDotEnv(file)
      expect([process.env.DOTENV_A, process.env.DOTENV_B, process.env.DOTENV_C, process.env.DOTENV_D, process.env.DOTENV_KEPT]).toEqual(['plain', 'quoted value', 'single', undefined, 'from-shell'])
      loadDotEnv(join(dir, 'absent'))
      loadDotEnv(dir) // a directory cannot be read as a file; boot goes on
    } finally {
      for (const k of ['DOTENV_A', 'DOTENV_B', 'DOTENV_C']) delete process.env[k]
    }
  })
})
