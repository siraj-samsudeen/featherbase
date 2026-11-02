import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

function command(...args) {
  return spawnSync(process.execPath, ['tools/featherbase.mjs', ...args], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, DATABASE_URL: 'not-a-database-url' },
  })
}

test('root help works without database configuration', () => {
  const result = command()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Featherbase/)
  for (const action of ['setup', 'start', 'health']) assert.match(result.stdout, new RegExp(`^ +featherbase ${action}`, 'm'))
})

test('a registered executable runs outside the checkout without a database', () => {
  const prefix = mkdtempSync(join(tmpdir(), 'featherbase-bin-'))
  const root = resolve('.')
  const windows = process.platform === 'win32'
  try {
    const registered = spawnSync('npm', ['link', '--offline', '--ignore-scripts', '--package-lock=false', '--no-audit', '--no-fund'], {
      cwd: root, encoding: 'utf8', timeout: 30000, shell: windows,
      env: { ...process.env, npm_config_prefix: prefix },
    })
    assert.equal(registered.status, 0, registered.stdout + registered.stderr)
    const bin = windows ? join(prefix, 'featherbase.cmd') : join(prefix, 'bin', 'featherbase')
    const result = spawnSync(bin, ['--help'], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 15000, shell: windows,
      env: { ...process.env, DATABASE_URL: 'not-a-database-url' },
    })
    assert.equal(result.status, 0, result.error?.message || result.stderr || 'registered command failed')
    assert.match(result.stdout, /Featherbase/)
    for (const action of ['setup', 'start', 'health']) assert.match(result.stdout, new RegExp(`^ +featherbase ${action}`, 'm'))
  } finally {
    rmSync(prefix, { recursive: true, force: true })
  }
})

for (const action of ['setup', 'start', 'health', 'advanced']) {
  test(`${action} help needs no database`, () => {
    const result = command(action, '--help')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /featherbase/)
  })
}

test('a mistyped command fails with a next action', () => {
  const result = command('setpu')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Run featherbase --help/)
  assert.doesNotMatch(result.stdout, /Preparing|Migrating/)
})

test('unknown setup options fail before database work', () => {
  const result = command('setup', '--yes-please')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unknown option/)
})

test('advanced help groups administration by purpose', () => {
  const result = command('advanced')
  assert.equal(result.status, 0, result.stderr)
  for (const group of ['database', 'people', 'apps', 'settings', 'operations']) assert.match(result.stdout, new RegExp(group))
})

test('advanced operation help does not initialize a database', () => {
  const result = command('advanced', 'apps', 'install-app', '--help')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /install-app/)
})

test('base startup reaches database preparation without building apps', () => {
  const result = spawnSync(process.execPath, ['tools/dev.mjs', '--check'], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, NODE_ENV: 'development', FEATHERBASE_ENV: 'development',
      DATABASE_URL: 'postgres://postgres:do-not-print-this@127.0.0.1:1/base_start_test', API_PORT: '18058', WEB_PORT: '15258' },
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /Preparing Featherbase: database base_start_test/)
  assert.match(result.stderr, /Can't reach Postgres/)
  assert.doesNotMatch(result.stdout + result.stderr, /Building|Installing apps|npm ci|do-not-print-this/)
})
