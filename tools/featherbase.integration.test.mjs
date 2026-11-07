import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const { default: postgres } = createRequire(new URL('../apps/server/package.json', import.meta.url))('postgres')

test('public setup preserves an existing person on repeat', async () => {
  const target = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/featherbase')
  target.pathname = `/fb_base_cli_${process.pid}_test`
  const env = { ...process.env, DATABASE_URL: target.toString(), NODE_ENV: 'development', FEATHERBASE_ENV: 'development', FEATHERBASE_APP_PATHS: '[]' }
  const command = (...args) => spawnSync(process.execPath, ['tools/featherbase.mjs', ...args], { env, encoding: 'utf8', timeout: 60000 })
  const sql = postgres(target.toString(), { max: 1, onnotice: () => {} })
  try {
    const setup = command('setup')
    assert.equal(setup.status, 0, setup.stdout + setup.stderr)
    assert.match(setup.stdout, /Next: featherbase start/)
    assert.equal(Number((await sql`select count(*) as n from featherbase.installed_app`)[0].n), 0)
    const created = command('advanced', 'people', 'create-person', 'base-cli@example.test', 'base-cli-test-password', '--roles', 'All')
    assert.equal(created.status, 0, created.stdout + created.stderr)
    const repeated = command('setup')
    assert.equal(repeated.status, 0, repeated.stdout + repeated.stderr)
    assert.equal(Number((await sql`select count(*) as n from featherbase.person where email = 'base-cli@example.test'`)[0].n), 1)
  } finally {
    await sql.end({ timeout: 1 })
    const adminUrl = new URL(target)
    adminUrl.pathname = '/postgres'
    const admin = postgres(adminUrl.toString(), { max: 1 })
    try { await admin`drop database if exists ${admin(target.pathname.slice(1))}` } finally { await admin.end({ timeout: 1 }) }
  }
})

test('health reports a real scheduled-job failure through JSON', async () => {
  const target = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/featherbase')
  target.pathname = `/fb_base_health_${process.pid}_test`
  const env = { ...process.env, DATABASE_URL: target.toString(), NODE_ENV: 'development', FEATHERBASE_ENV: 'development', FEATHERBASE_APP_PATHS: '[]', BASE_CLI_SECRET: 'must-not-appear-in-report' }
  const command = (...args) => spawnSync(process.execPath, ['tools/featherbase.mjs', ...args], { env, encoding: 'utf8', timeout: 60000 })
  const sql = postgres(target.toString(), { max: 1, onnotice: () => {} })
  try {
    const setup = command('setup')
    assert.equal(setup.status, 0, setup.stdout + setup.stderr)
    const healthy = command('health', '--json')
    assert.equal(healthy.status, 0, healthy.stdout + healthy.stderr)
    assert.ok(Array.isArray(JSON.parse(healthy.stdout).checks))
    await sql`update featherbase.scheduled_job set enabled = true, last_run_at = now(), last_outcome = 'error' where method = 'check_sla'`
    const failed = command('health', '--json')
    assert.equal(failed.status, 1, failed.stdout + failed.stderr)
    const check = JSON.parse(failed.stdout).checks.find((entry) => entry.key === 'scheduled-job:check_sla')
    assert.equal(check.ok, false)
    assert.ok(check.fix)
    assert.ok(!failed.stdout.includes(env.BASE_CLI_SECRET))
  } finally {
    await sql.end({ timeout: 1 })
    const adminUrl = new URL(target)
    adminUrl.pathname = '/postgres'
    const admin = postgres(adminUrl.toString(), { max: 1 })
    try { await admin`drop database if exists ${admin(target.pathname.slice(1))}` } finally { await admin.end({ timeout: 1 }) }
  }
})
