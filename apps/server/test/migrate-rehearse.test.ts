// `cli migrate:rehearse`: every pending migration in ONE transaction that is
// always rolled back, with what each reported. The rehearsal is driven
// in-process here; the CLI only spawns it so --database-url can point
// DATABASE_URL elsewhere first (cli.test.ts).
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { parseRehearseOptions, rehearse } from '../src/migrate-rehearse'
import { dropScratchDatabases, scratchDatabase } from './scratch-database'

afterAll(dropScratchDatabases, 60_000)

// The shared test database always has other sessions (this suite's own), so
// these rehearse it as a live database, on purpose.
async function run(): Promise<string> {
  const lines: string[] = []
  await rehearse((line) => lines.push(line), { allowLive: true })
  return lines.join('\n')
}

const ledger = async () => (await sql`select name from featherbase.migration order by name`).map((r) => String(r.name))

describe('migrate:rehearse options', () => {
  test('reads --database-url <dsn>; without it the rehearsal is against this database', () => {
    expect(parseRehearseOptions(['--database-url', 'postgres://x/y'])).toEqual({ databaseUrl: 'postgres://x/y', allowLive: false })
    expect(parseRehearseOptions([])).toEqual({ databaseUrl: null, allowLive: false })
  })

  test('--allow-live lets the rehearsal run on a database others are connected to', () => {
    expect(parseRehearseOptions(['--allow-live', '--database-url', 'postgres://x/y'])).toEqual({ databaseUrl: 'postgres://x/y', allowLive: true })
  })

  test('refuses an unknown argument and --database-url with no address', () => {
    expect(() => parseRehearseOptions(['--bogus'])).toThrow('migrate:rehearse: unknown argument --bogus')
    expect(() => parseRehearseOptions(['--database-url'])).toThrow('--database-url needs a database URL')
    expect(() => parseRehearseOptions(['--database-url', ''])).toThrow('--database-url needs a database URL')
  })
})

describe('migrate:rehearse', () => {
  test('with nothing pending it says so and changes nothing', async () => {
    const out = await run()
    expect(out).toBe('migrate:rehearse — in a rolled-back transaction; pending: none\nmigrate:rehearse — rolled back; nothing was changed')
  })

  test('pending migrations run in order with what each reported, then roll back with the ledger untouched', async () => {
    await sql`delete from featherbase.migration where name in ('0101_person_rename.ts', '0101a_service_account_name_unique.sql', '0102_person_resolution.ts')`
    const before = await ledger()
    const log = console.log
    const out = await run()
    expect(out.split('\n')[0]).toBe('migrate:rehearse — in a rolled-back transaction; pending: 0101_person_rename.ts, 0101a_service_account_name_unique.sql, 0102_person_resolution.ts')
    // A migration's report (what its up() logs) comes before its "applied" line.
    expect(out).toContain('person-rename: already applied\napplied 0101_person_rename.ts\napplied 0101a_service_account_name_unique.sql\n')
    expect(out).toMatch(/person-resolution plan \(0102, Phase 1a-i\)[\s\S]*\napplied 0102_person_resolution\.ts\n/)
    expect(out.endsWith('migrate:rehearse — rolled back; nothing was changed')).toBe(true)
    expect(await ledger()).toEqual(before)
    expect(console.log).toBe(log)
  })

  test('a migration that fails stops the rehearsal with its error, and nothing is changed', async () => {
    await sql`delete from featherbase.migration where name = '0123_instance_health.sql'`
    await sql.unsafe('alter table featherbase.instance_settings_apply rename to instance_settings_apply_moved')
    const before = await ledger()
    const log = console.log
    await expect(run()).rejects.toThrow('relation "featherbase.instance_settings_apply" does not exist')
    expect(console.log).toBe(log)
    expect(await ledger()).toEqual(before)
  })
})

// #557: a restored snapshot can predate 0094, with its ledger in `public`.
// The rehearsal applies its pending files the way the migrator would, so a
// pre-0094 file runs against public storage, not the platform schema.
describe('migrate:rehearse on a database of its own', () => {
  async function rehearseOn(scratch: Awaited<ReturnType<typeof scratchDatabase>>, allowLive = true): Promise<string> {
    const lines: string[] = []
    await scratch.rehearsal.rehearse((line) => lines.push(line), { allowLive })
    return lines.join('\n')
  }

  it('a legacy database with its ledger in public rehearses a pre-0094 file, and keeps nothing', async () => {
    const all = (await sql`select name from migration order by name`).map((r) => String(r.name))
    const scratch = await scratchDatabase(`create table public.migration (name text primary key, applied_at timestamptz not null default now());
      create table public.installed_app (name text primary key)`)
    try {
      await scratch.db`insert into public.migration ${scratch.db(all.filter((f) => f !== '0089_app_enablement.sql').map((name) => ({ name })))}`
      const out = await rehearseOn(scratch)
      expect(out).toBe([
        'migrate:rehearse — in a rolled-back transaction; pending: 0089_app_enablement.sql',
        'applied 0089_app_enablement.sql',
        'migrate:rehearse — rolled back; nothing was changed',
      ].join('\n'))
      expect(await scratch.db`select 1 from public.migration where name = '0089_app_enablement.sql'`).toHaveLength(0)
      expect((await scratch.db`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'installed_app'`).map((r) => r.column_name)).toEqual(['name'])
      expect(await scratch.db`select to_regnamespace('featherbase') as s`).toEqual([{ s: null }])
    } finally {
      await scratch.close()
    }
  }, 60_000)

  it('a legacy database that has not reached 0087 is refused, as the migrator refuses it', async () => {
    const scratch = await scratchDatabase(`create table public.migration (name text primary key, applied_at timestamptz not null default now());
      insert into public.migration (name) values ('0001_init.sql')`)
    try {
      await expect(rehearseOn(scratch)).rejects.toThrow('Legacy database requires an intermediate historical upgrade through 0087; missing migrations:\n0002_')
    } finally {
      await scratch.close()
    }
  }, 60_000)

  // #558: a restored copy has no other sessions; a live instance always has
  // its server's. The rehearsal holds each change's locks until it ends, so
  // pointed at a live database it would block the instance's users.
  const LEGACY_0089 = `create table public.migration (name text primary key, applied_at timestamptz not null default now());
    create table public.installed_app (name text primary key)`
  async function legacyCopy() {
    const all = (await sql`select name from migration order by name`).map((r) => String(r.name))
    const scratch = await scratchDatabase(LEGACY_0089)
    await scratch.db`insert into public.migration ${scratch.db(all.filter((f) => f !== '0089_app_enablement.sql').map((name) => ({ name })))}`
    return scratch
  }

  it('a database another session is connected to is refused before anything runs, unless --allow-live', async () => {
    const scratch = await legacyCopy()
    try {
      await expect(rehearseOn(scratch, false)).rejects.toThrow(
        /^Refusing to rehearse: 1 other session is connected to this database, so it looks like a live instance, not a restored copy\./,
      )
      await expect(rehearseOn(scratch, false)).rejects.toThrow('pass --allow-live if you truly mean it')
      expect(await rehearseOn(scratch, true)).toContain('applied 0089_app_enablement.sql')
    } finally {
      await scratch.close()
    }
  }, 60_000)

  it('a copy nobody else is connected to rehearses without --allow-live', async () => {
    const scratch = await legacyCopy()
    await scratch.db.end()
    const check = postgres(scratch.url, { max: 1, onnotice: () => {} })
    try {
      // The check connection opens only after the rehearsal, so it is alone.
      expect(await rehearseOn(scratch, false)).toContain('applied 0089_app_enablement.sql')
      expect(await check`select 1 from public.migration where name = '0089_app_enablement.sql'`).toHaveLength(0)
    } finally {
      await check.end({ timeout: 5 })
      await scratch.close()
    }
  }, 60_000)

  it('a change that has to wait for a lock fails within seconds instead of queueing', async () => {
    const scratch = await legacyCopy()
    try {
      await scratch.db.begin(async (tx) => {
        await tx`lock table public.installed_app in access share mode`
        const started = Date.now()
        await expect(rehearseOn(scratch)).rejects.toThrow(
          '0089_app_enablement.sql waited more than 2s for a lock another session holds, so the rehearsal stopped: canceling statement due to lock timeout',
        )
        expect(Date.now() - started).toBeLessThan(10_000)
      })
      expect((await scratch.db`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'installed_app'`).map((r) => r.column_name)).toEqual(['name'])
    } finally {
      await scratch.close()
    }
  }, 60_000)

  it('a session connected as another role counts too', async () => {
    const role = `rehearse_other_${Date.now()}`
    const scratch = await legacyCopy()
    // The rehearsal connects as a role that cannot read other roles' session
    // details; the session it must notice belongs to the test's superuser.
    await scratch.db.unsafe(`create role ${role} login password 'x'; grant all on database "${new URL(scratch.url).pathname.slice(1)}" to ${role}`)
    const url = new URL(scratch.url)
    url.username = role
    url.password = 'x'
    const limited = postgres(url.toString(), { max: 1, onnotice: () => {} })
    try {
      const [{ n }] = await limited`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'`
      // What made the check blind: other roles' sessions show no backend type.
      expect(n).toBe(0)
      await expect(scratch.rehearsal.assertNotLive(limited)).rejects.toThrow(/^Refusing to rehearse: 1 other session is connected/)
    } finally {
      await limited.end({ timeout: 5 })
      await scratch.db.unsafe(`drop owned by ${role}; drop role ${role}`).catch(() => {})
      await scratch.close()
    }
  }, 60_000)
})
