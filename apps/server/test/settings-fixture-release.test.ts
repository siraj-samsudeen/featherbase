// #465 (instance-settings-as-code 3.5): manifests no longer carry instance
// settings. That must not move any live setting: a real release of this code
// over a database that the previous code seeded from a manifest with a System
// Settings fixture leaves every setting exactly as it was.
//
// Real release commands, separate processes, committed transactions (the
// release-upgrade.test.ts pattern). Never touches the configured database:
// it creates uniquely named ones and drops only those.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { config } from '../src/config'

// The last commit before manifests stopped accepting instance settings.
// CI fetches history; a shallow local checkout must fetch this commit.
const oldCommit = '6f0de9eb3f397c3c0a371904049cfa505456b2a2'
const server = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(server, '../..')
const tsx = resolve(server, 'node_modules/tsx/dist/cli.mjs')
const admin = postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
const name = `featherbase_settings_fixture_${randomUUID().replaceAll('-', '')}`
let historical: string

function urlFor(db: string): string {
  const url = new URL(config.databaseUrl)
  url.pathname = `/${db}`
  return url.toString()
}

function run(cwd: string, script: string): string {
  try {
    return execFileSync(process.execPath, [tsx, script], {
      cwd, encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, DATABASE_URL: urlFor(name), FEATHERBASE_ENV: 'production', NODE_ENV: 'production', ADMIN_PASSWORD: '', SITE_URL: 'https://featherbase.example.com', JWT_SECRET: 'a-production-secret', ALLOW_MOCK_OAUTH: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    throw new Error(`${failure.stdout ?? ''}${failure.stderr ?? ''}`)
  }
}

beforeAll(async () => {
  historical = mkdtempSync(resolve(tmpdir(), 'featherbase-settings-fixture-'))
  const archive = execFileSync('git', ['archive', oldCommit, 'apps/server', 'packages/shared', 'package.json'], {
    cwd: repo, maxBuffer: 20 * 1024 * 1024,
  })
  execFileSync('tar', ['-x', '-C', historical], { input: archive })
  const oldServer = resolve(historical, 'apps/server')
  mkdirSync(resolve(oldServer, 'node_modules'))
  for (const entry of readdirSync(resolve(server, 'node_modules')))
    symlinkSync(entry === 'shared' ? resolve(historical, 'packages/shared') : resolve(server, 'node_modules', entry),
      resolve(oldServer, 'node_modules', entry))
  symlinkSync(resolve(repo, 'packages/shared/node_modules'), resolve(historical, 'packages/shared/node_modules'))
  await admin.unsafe(`create database "${name}"`)
}, 120_000)

afterAll(async () => {
  await admin.unsafe(`drop database if exists "${name}" with (force)`)
  await admin.end()
  if (historical) rmSync(historical, { recursive: true, force: true })
})

it('a release over a database seeded from the old System Settings fixture changes no setting', async () => {
  const oldServer = resolve(historical, 'apps/server')
  expect(run(oldServer, 'src/release.ts')).toContain('migrations up to date')
  mkdirSync(resolve(oldServer, 'test/fixtures'), { recursive: true })
  cpSync(resolve(server, 'test/fixtures/settings-fixture-seed.ts'), resolve(oldServer, 'test/fixtures/settings-fixture-seed.ts'))
  run(oldServer, 'test/fixtures/settings-fixture-seed.ts')

  const db = postgres(urlFor(name), { max: 1, onnotice: () => {}, prepare: false })
  try {
    const live = async () => ({
      settings: await db`select field, value from featherbase.single_value where table_name = 'System Settings' order by field`,
      methods: await db`select * from featherbase.sign_in_method order by row_id`,
      jobs: await db`select row_id, enabled from featherbase.scheduled_job order by row_id`,
      apps: await db`select name, fixtures, manifest from featherbase.installed_app order by name`,
    })
    const before = await live()
    // The seed really is the old shape: the fixture wrote System Settings and
    // the ledger recorded it.
    expect(before.settings).toContainEqual({ field: 'app_name', value: 'Edited In Admin' })
    expect(before.settings).toContainEqual({ field: 'session_hours', value: '12' })
    expect(before.apps).toEqual([expect.objectContaining({
      name: 'instance_manifest', fixtures: [{ table: 'System Settings', row_id: 'System Settings' }],
    })])

    expect(run(server, 'src/release.ts')).toContain('migrations up to date')
    expect(await live()).toEqual(before)

    // A server start, and uninstalling that app, leave the settings too.
    run(server, 'test/fixtures/settings-fixture-after.ts')
    expect({ ...(await live()), apps: [] }).toEqual({ ...before, apps: [] })
  } finally {
    await db.end()
  }
}, 240_000)
