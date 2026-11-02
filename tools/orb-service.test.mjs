import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('supervised startup restores only declared runtime selections from a private file', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-service-env-'))
  const file = join(dir, '.env.service.json')
  const run = (action, env) => spawnSync(process.execPath, ['--import', 'tsx', '../../tools/orb-service.mts', action, file], {
    cwd: 'apps/server', encoding: 'utf8', timeout: 15000, env: { ...process.env, ...env },
  })
  try {
    const captured = run('capture', {
      DATABASE_URL: 'postgres://postgres:private-password@127.0.0.1:1/fb_selected',
      API_PORT: '18059', WEB_PORT: '15259', FEATHERBASE_APP_PATHS: '[]',
      NODE_ENV: 'development', FEATHERBASE_ENV: 'development',
      JWT_SECRET: 'private-jwt', UNRELATED_SECRET: 'do-not-collect',
    })
    assert.equal(captured.status, 0, captured.stderr)
    assert.equal(captured.stdout, '')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(saved.API_PORT, '18059')
    assert.equal(saved.WEB_PORT, '15259')
    assert.equal(saved.JWT_SECRET, 'private-jwt')
    assert.equal(saved.UNRELATED_SECRET, undefined)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    const started = run('start', { DATABASE_URL: 'invalid-supervisor-default', API_PORT: '19999', WEB_PORT: '19998' })
    assert.equal(started.status, 1, started.stdout + started.stderr)
    assert.match(started.stdout, /Preparing Featherbase: database fb_selected/)
    assert.match(started.stderr, /Can't reach Postgres/)
    assert.doesNotMatch(started.stdout + started.stderr, /private-password|private-jwt|do-not-collect/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
