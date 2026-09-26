import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { config } from '../src/config'

// Real release commands, separate processes and committed transactions. Never
// modify the configured database: create uniquely named DBs and drop only those.
// CI fetches history; shallow local checkouts must fetch this pinned commit.
const oldCommit = '3a6770ff651a308bfae0e31b5c525705c356a5a5'
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
      env: { ...process.env, DATABASE_URL: urlFor(name), FEATHERBASE_ENV: 'production', NODE_ENV: 'production', ADMIN_PASSWORD: '' },
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
  expect(run(template, oldServer)).toContain('migrations up to date (88 total)')
}, 120_000)

afterAll(async () => {
  for (const name of databases.reverse()) await admin.unsafe(`drop database "${name}" with (force)`)
  await admin.end()
  if (historical) rmSync(historical, { recursive: true, force: true })
})

it('upgrades exact production-era storage, preserving rows, OIDs, grants and ledger timestamps', async () => {
  await withDatabase(template, async (name, db) => {
    const oldServer = resolve(historical, 'apps/server')
    mkdirSync(resolve(oldServer, 'test/fixtures'), { recursive: true })
    cpSync(resolve(server, 'test/fixtures/legacy-release-seed.ts'), resolve(oldServer, 'test/fixtures/legacy-release-seed.ts'))
    run(name, oldServer, 'test/fixtures/legacy-release-seed.ts')
    const history = await db`select name, applied_at from public.migration order by name`
    const [before] = await db`select 'public.table_def'::regclass::oid as core,
      'public.team_task'::regclass::oid as task, 'public.site'::regclass::oid as site`
    expect(run(name)).toContain('applied 0094_featherbase_schema.sql')
    const [after] = await db`select 'featherbase.table_def'::regclass::oid as core,
      'tasker.task'::regclass::oid as task, 'public.site'::regclass::oid as site`
    expect(after).toEqual(before)
    expect(await db`select name, applied_at from featherbase.migration where name < '0088' order by name`).toEqual(history)
    expect(await db`select task_title, project from tasker.task where row_id = 'task-19'`)
      .toEqual([{ task_title: 'Asymmetric task', project: 'project-73' }])
    expect(await db`select project_name from tasker.project where row_id = 'project-73'`).toEqual([{ project_name: 'Preserved project' }])
    expect(await db`select ref_table, ref_name, content from featherbase.comment where row_id = 'comment-41'`)
      .toEqual([{ ref_table: 'tasker.task', ref_name: 'task-19', content: 'Keep discussion' }])
    expect(await db`select full_name from featherbase."user" where row_id = 'Administrator'`).toEqual([{ full_name: 'Migration sentinel' }])
    expect(await db`select settings from featherbase.user_settings where table_name = 'Task Management Focus'`)
      .toEqual([{ settings: { task_ids: ['task-19'] } }])
    expect(await db`select host, schema from public.site`).toEqual([{ host: 'legacy.invalid', schema: 'tenant_legacy' }])
    expect(await db`select owner_app from featherbase.permission where row_id = 'independent-grant'`).toEqual([{ owner_app: null }])
    expect(await db`select distinct owner_app from featherbase.permission where row_id in
      (select jsonb_array_elements_text(perms) from featherbase.installed_app where name = 'tasker')`)
      .toEqual([{ owner_app: 'tasker' }])
    expect(await db`select has_table_privilege('app_client', 'tasker.task', 'select') as allowed,
      has_schema_privilege('app_client', 'featherbase', 'usage') as usage`)
      .toEqual([{ allowed: false, usage: true }])
    const ledger = await db`select * from featherbase.migration order by name`
    const grants = await db`select * from featherbase.permission order by row_id`
    expect(run(name)).not.toContain('applied ')
    expect(await db`select * from featherbase.migration order by name`).toEqual(ledger)
    expect(await db`select * from featherbase.permission order by row_id`).toEqual(grants)
  })
}, 120_000)

it('fresh release and empty production-era upgrade converge', async () => {
  const shape = (db: ReturnType<typeof postgres>) => db`
    select table_schema, table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns where table_schema in ('public', 'featherbase')
    order by table_schema, table_name, ordinal_position`
  await withDatabase(undefined, async (fresh, freshDb) => {
    run(fresh)
    await withDatabase(template, async (upgrade, upgradeDb) => {
      run(upgrade)
      expect(await shape(upgradeDb)).toEqual(await shape(freshDb))
      expect(await upgradeDb`select to_regclass('public.table_def') as legacy,
        to_regclass('featherbase.table_def') is not null as current`).toEqual([{ legacy: null, current: true }])
    })
  })
}, 120_000)

it.each(['0088_runtime_storage.sql', '0094_featherbase_schema.sql'])('rolls back %s even when its ledger insert fails, then resumes once', async file => {
  await withDatabase(template, async (name, db) => {
    await db.unsafe(`create function public.reject_migration() returns trigger language plpgsql as $$
      begin if new.name = '${file}' then raise exception 'injected ledger failure'; end if; return new; end $$;
      create trigger reject_migration before insert on public.migration
      for each row execute function public.reject_migration();`)
    expect(() => run(name)).toThrow('injected ledger failure')
    expect(await db`select to_regclass('featherbase.migration') as moved`).toEqual([{ moved: null }])
    expect(await db`select name from public.migration where name = ${file}`).toEqual([])
    expect(await db`select count(*)::int as count from information_schema.columns
      where table_schema = 'public' and table_name = 'table_def' and column_name = 'owner_app'`)
      .toEqual([{ count: file.startsWith('0088') ? 0 : 1 }])
    expect(await db`select count(*)::int as count from public.migration`).toEqual([{ count: file.startsWith('0088') ? 88 : 94 }])
    await db`drop trigger reject_migration on public.migration`
    await db`drop function public.reject_migration()`
    expect(run(name)).toContain(`applied ${file}`)
    expect(run(name)).not.toContain('applied ')
  })
}, 120_000)

it('rejects a ledger hole before any destination DDL', async () => {
  await withDatabase(template, async (name, db) => {
    await db`delete from public.migration where name = '0086_scheduled_job.ts'`
    expect(() => run(name)).toThrow(/intermediate historical upgrade[\s\S]*0086_scheduled_job.ts/)
    expect(await db`select nspname from pg_namespace where nspname = 'featherbase'`).toEqual([])
    expect(await db`select count(*)::int as count from public.migration`).toEqual([{ count: 87 }])
  })
}, 120_000)
