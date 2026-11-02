// Uses a disposable Postgres database; run alongside the CLI integration suite.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const { default: postgres } = createRequire(new URL('../apps/server/package.json', import.meta.url))('postgres')

test('supervised startup restores only declared runtime selections from a private file', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-service-env-'))
  const file = join(dir, '.env.service.json')
  const target = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/featherbase')
  target.pathname = `/fb_service_${process.pid}_test`
  const adminUrl = new URL(target)
  adminUrl.pathname = '/postgres'
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} })
  const sql = postgres(target.toString(), { max: 1, onnotice: () => {} })
  const run = (action, env, probe = '') => spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
    process.argv = [process.execPath, '../../tools/orb-service.mts', ${JSON.stringify(action)}, ${JSON.stringify(file)}];
    await import('../../tools/orb-service.mts');
    ${probe}
  `], {
    cwd: 'apps/server', encoding: 'utf8', timeout: 15000, env: { ...process.env, ...env },
  })
  try {
    await admin`create database ${admin(target.pathname.slice(1))}`
    await sql`create schema featherbase`
    await sql`create table featherbase.data_source (url_env text)`
    await sql`create table featherbase.installed_app (manifest jsonb)`
    // The actual instance and app declare these names; they are not in VARIABLES.
    const settings = JSON.parse(readFileSync('client-apps/jeyarama/instances/dash/instance-settings.json', 'utf8'))
    const manifest = JSON.parse(readFileSync('client-apps/jeyarama/dash/featherbase.json', 'utf8'))
    assert.equal(settings.settings['Data Source'][0].url_env, 'MOTHERDUCK_URL')
    assert.ok(manifest.secrets.includes('MOTHERDUCK_TOKEN'))
    await sql`insert into featherbase.data_source (url_env) values (${settings.settings['Data Source'][0].url_env}), ('UNSET_SOURCE_URL')`
    await sql`insert into featherbase.installed_app (manifest) values (${sql.json(manifest)}),
      (${sql.json({ secrets: [{ name: 'OPTIONAL_APP_TOKEN', optional: true }, { name: 'UNSET_APP_TOKEN', optional: true }] })})`
    const captured = run('capture', {
      DATABASE_URL: target.toString(),
      API_PORT: '18059', WEB_PORT: '15259', FEATHERBASE_APP_PATHS: '[]',
      NODE_ENV: 'development', FEATHERBASE_ENV: 'development',
      JWT_SECRET: 'private-jwt', UNRELATED_SECRET: 'do-not-collect',
      MOTHERDUCK_URL: 'md:private-warehouse', MOTHERDUCK_TOKEN: 'private-app-token',
      OPTIONAL_APP_TOKEN: 'private-optional-token', UNSET_SOURCE_URL: undefined, UNSET_APP_TOKEN: undefined,
    })
    assert.equal(captured.status, 0, captured.stderr)
    assert.equal(captured.stdout, '')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(saved.API_PORT, '18059')
    assert.equal(saved.WEB_PORT, '15259')
    assert.equal(saved.JWT_SECRET, 'private-jwt')
    assert.equal(saved.UNRELATED_SECRET, undefined)
    assert.equal(saved.MOTHERDUCK_URL, 'md:private-warehouse')
    assert.equal(saved.MOTHERDUCK_TOKEN, 'private-app-token')
    assert.equal(saved.OPTIONAL_APP_TOKEN, 'private-optional-token')
    assert.equal(saved.UNSET_SOURCE_URL, null)
    assert.equal(saved.UNSET_APP_TOKEN, null)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    // Stop startup at the existing database-preparation boundary, then inspect
    // the runtime owner's reads without printing any of the restored values.
    saved.DATABASE_URL = 'postgres://postgres:private-password@127.0.0.1:1/fb_selected'
    writeFileSync(file, JSON.stringify(saved))
    const started = run('start', {
      DATABASE_URL: 'invalid-supervisor-default', API_PORT: '19999', WEB_PORT: '19998',
      MOTHERDUCK_URL: 'wrong-supervisor-url', MOTHERDUCK_TOKEN: 'wrong-supervisor-token',
      OPTIONAL_APP_TOKEN: 'wrong-optional-token', UNSET_SOURCE_URL: 'wrong-source-default', UNSET_APP_TOKEN: 'wrong-app-default',
    }, `
      const { readNamedVariable } = await import('../../apps/server/src/env.ts');
      const restored = readNamedVariable('MOTHERDUCK_URL') === 'md:private-warehouse'
        && readNamedVariable('MOTHERDUCK_TOKEN') === 'private-app-token'
        && readNamedVariable('OPTIONAL_APP_TOKEN') === 'private-optional-token'
        && readNamedVariable('UNSET_SOURCE_URL') === undefined
        && readNamedVariable('UNSET_APP_TOKEN') === undefined;
      if (!restored) throw new Error('Declared runtime variables were not restored');
      console.log('Declared runtime variables restored');
    `)
    assert.equal(started.status, 1, started.stdout + started.stderr)
    assert.match(started.stdout, /Preparing Featherbase: database fb_selected/)
    assert.match(started.stdout, /Declared runtime variables restored/)
    assert.match(started.stderr, /Can't reach Postgres/)
    assert.doesNotMatch(started.stdout + started.stderr, /private-password|private-jwt|do-not-collect|private-warehouse|private-app-token|private-optional-token/)
  } finally {
    await sql.end({ timeout: 1 })
    try { await admin`drop database if exists ${admin(target.pathname.slice(1))}` } finally { await admin.end({ timeout: 1 }) }
    rmSync(dir, { recursive: true, force: true })
  }
})
