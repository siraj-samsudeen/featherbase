import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { config } from '../src/config'
import { LAST_RELEASE_BEFORE_BASELINE, replacedByBaseline } from '../src/migrate'
import { schemaShape, seedRows } from './schema-shape'

// Real release commands, separate processes and committed transactions. Never
// modify the configured database: create uniquely named DBs and drop only those.
// The template is what dev and prod are today: installed by the last release
// before the baseline (#692), its 139 migrations and its patch applied. CI
// fetches history; shallow local checkouts must fetch this pinned commit.
const oldCommit = 'e562331d6863ac1a1a68fd030c99101d287820db'
const server = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(server, '../..')
const tsx = resolve(server, 'node_modules/tsx/dist/cli.mjs')
const admin = postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
const databases: string[] = []
let historical: string
let template: string

function urlFor(name: string): string {
  const url = new URL(config.databaseUrl)
  url.pathname = `/${name}`
  return url.toString()
}

function run(name: string, cwd = server, script = 'src/release.ts'): string {
  try {
    return execFileSync(process.execPath, [tsx, script], {
      cwd, encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, DATABASE_URL: urlFor(name), FEATHERBASE_ENV: 'production', NODE_ENV: 'production', ADMIN_PASSWORD: '', INSTANCE_ADDRESSES: '[{"address":"https://featherbase.example.com","opens":"admin","emails":true}]', JWT_SECRET: 'a-production-secret', ALLOW_MOCK_OAUTH: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    throw new Error(`${failure.stdout ?? ''}${failure.stderr ?? ''}`)
  }
}

async function database(from?: string): Promise<string> {
  const name = `featherbase_upgrade_${randomUUID().replaceAll('-', '')}`
  await admin.unsafe(`create database "${name}"${from ? ` template "${from}"` : ''}`)
  databases.push(name)
  return name
}

async function withDatabase(from: string | undefined, check: (name: string, db: ReturnType<typeof postgres>) => Promise<void>) {
  const name = await database(from)
  const db = postgres(urlFor(name), { max: 1, onnotice: () => {}, prepare: false })
  try { await check(name, db) } finally { await db.end() }
}

beforeAll(async () => {
  expect(oldCommit.startsWith(LAST_RELEASE_BEFORE_BASELINE)).toBe(true)
  historical = mkdtempSync(resolve(tmpdir(), 'featherbase-release-'))
  const archive = execFileSync('git', ['archive', oldCommit, 'apps/server', 'packages/shared', 'package.json'], {
    cwd: repo, maxBuffer: 20 * 1024 * 1024,
  })
  execFileSync('tar', ['-x', '-C', historical], { input: archive })
  // Reuse installed third-party dependencies, but historical workspace source.
  const oldServer = resolve(historical, 'apps/server')
  mkdirSync(resolve(oldServer, 'node_modules'))
  for (const entry of readdirSync(resolve(server, 'node_modules'))) {
    symlinkSync(entry === 'shared' ? resolve(historical, 'packages/shared') : resolve(server, 'node_modules', entry),
      resolve(oldServer, 'node_modules', entry))
  }
  symlinkSync(resolve(repo, 'packages/shared/node_modules'), resolve(historical, 'packages/shared/node_modules'))
  template = await database()
  const installed = run(template, oldServer)
  expect(installed).toContain('migrations up to date (139 total)')
  expect(installed).toContain('patches up to date (1 total)')
}, 240_000)

afterAll(async () => {
  for (const name of databases.reverse()) await admin.unsafe(`drop database "${name}" with (force)`)
  await admin.end()
  if (historical) rmSync(historical, { recursive: true, force: true })
})

it('adopts a database the last release before the baseline installed: the schema and seed rows of a fresh install, its own rows and ledger kept', async () => {
  await withDatabase(undefined, async (fresh, freshDb) => {
    expect(run(fresh)).toContain('applied 0140_baseline.sql')
    await withDatabase(template, async (name, db) => {
      await db`update featherbase.person set full_name = 'Adoption sentinel' where row_id = 'Guest'`
      const history = await db`select name, applied_at from featherbase.migration order by name`
      expect(history.map((r) => String(r.name)).sort()).toEqual([...replacedByBaseline()].sort())
      const output = run(name)
      expect(output).toContain('adopted the baseline: recorded 0140_baseline.sql, 0141_administrator_password.ts, 0142_mock_google_sign_in.ts without running them')
      expect(output).toContain('applied 0143_drop_patch_log.sql')
      expect(output).not.toContain('applied 0140_baseline.sql')
      expect(await schemaShape(db)).toEqual(await schemaShape(freshDb))
      const sentinel = (rows: Record<string, string[]>) => ({ ...rows, 'featherbase.person': rows['featherbase.person'].map((r) => r.replace('Adoption sentinel', 'Guest')) })
      expect(sentinel(await seedRows(db))).toEqual(await seedRows(freshDb))
      expect(await db`select full_name from featherbase.person where row_id = 'Guest'`).toEqual([{ full_name: 'Adoption sentinel' }])
      expect(await db`select name, applied_at from featherbase.migration where name < '0140' order by name`).toEqual(history)
      expect(run(name)).not.toContain('applied ')
    })
  })
}, 240_000)

it('refuses a database that lacks one of the migrations the baseline replaces, before changing anything', async () => {
  await withDatabase(template, async (name, db) => {
    await db`delete from featherbase.migration where name = '0139_import_conflicts.ts'`
    const before = await schemaShape(db)
    expect(() => run(name)).toThrow(/Refusing to migrate: this database has 138 of the 139 migrations the baseline replaces; it lacks 0139_import_conflicts\.ts\.[\s\S]*commit e562331d/)
    expect(await schemaShape(db)).toEqual(before)
    expect(await db`select count(*)::int as count from featherbase.migration`).toEqual([{ count: 138 }])
    expect(await db`select to_regclass('featherbase.patch_log') is not null as kept`).toEqual([{ kept: true }])
  })
}, 120_000)
