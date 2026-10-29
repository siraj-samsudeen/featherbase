// `cli migrate:rehearse`: every pending migration in ONE transaction that is
// always rolled back, with what each reported. The rehearsal is driven
// in-process here; the CLI only spawns it so --database-url can point
// DATABASE_URL elsewhere first (cli.test.ts).
import postgres from 'postgres'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { parseRehearseOptions, rehearse } from '../src/migrate-rehearse'
import { ADOPTED_WITH_BASELINE } from '../src/migrate'
import { dropScratchDatabases, scratchDatabase, scratchInstalledBeforeBaseline } from './scratch-database'

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
    await sql`delete from featherbase.migration where name in ('0142_mock_google_sign_in.ts', '0143_drop_patch_log.sql')`
    await sql.unsafe('create table featherbase.patch_log (patch text primary key)')
    const before = await ledger()
    const log = console.log
    const out = await run()
    expect(out).toBe([
      'migrate:rehearse — in a rolled-back transaction; pending: 0142_mock_google_sign_in.ts, 0143_drop_patch_log.sql',
      'applied 0142_mock_google_sign_in.ts',
      'applied 0143_drop_patch_log.sql',
      'migrate:rehearse — rolled back; nothing was changed',
    ].join('\n'))
    expect(await ledger()).toEqual(before)
    expect(await sql`select to_regclass('featherbase.patch_log') as r`).toEqual([{ r: 'featherbase.patch_log' }])
    expect(console.log).toBe(log)
  })

  test('a migration that fails stops the rehearsal with its error, and nothing is changed', async () => {
    await sql`delete from featherbase.migration where name = '0143_drop_patch_log.sql'`
    await sql.unsafe('create table featherbase.patch_log (patch text primary key); create view featherbase.patch_log_names as select patch from featherbase.patch_log')
    const before = await ledger()
    const log = console.log
    await expect(run()).rejects.toThrow('cannot drop table patch_log because other objects depend on it')
    expect(console.log).toBe(log)
    expect(await ledger()).toEqual(before)
  })
})

// #557: a restored snapshot of an instance installed before the baseline
// (#692) rehearses its adoption: the baseline recorded, the rest applied.
describe('migrate:rehearse on a database of its own', () => {
  async function rehearseOn(scratch: Awaited<ReturnType<typeof scratchDatabase>>, allowLive = true): Promise<string> {
    const lines: string[] = []
    await scratch.rehearsal.rehearse((line) => lines.push(line), { allowLive })
    return lines.join('\n')
  }

  it('a copy installed before the baseline rehearses its adoption, and keeps nothing', async () => {
    const scratch = await scratchInstalledBeforeBaseline()
    try {
      const before = await scratch.db`select count(*)::int as n from featherbase.migration`
      expect(await rehearseOn(scratch)).toBe([
        'migrate:rehearse — in a rolled-back transaction; pending: 0143_drop_patch_log.sql',
        `adopted the baseline: recorded ${ADOPTED_WITH_BASELINE.join(', ')} without running them`,
        'applied 0143_drop_patch_log.sql',
        'migrate:rehearse — rolled back; nothing was changed',
      ].join('\n'))
      expect(await scratch.db`select count(*)::int as n from featherbase.migration`).toEqual(before)
      expect(await scratch.db`select to_regclass('featherbase.patch_log') as r`).toEqual([{ r: 'featherbase.patch_log' }])
    } finally {
      await scratch.close()
    }
  }, 120_000)

  it("what a migration reports comes before its applied line, and the console is put back", async () => {
    const scratch = await scratchInstalledBeforeBaseline()
    try {
      // No shipped migration after the baseline reports anything, so this one
      // is made to: the rehearsal must carry a report, whoever writes it.
      vi.resetModules()
      vi.doMock('../src/migrate', async (original) => {
        const real = await original<typeof import('../src/migrate')>()
        return { ...real, applyMigrationFile: async (file: string) => { console.log('dropped %s', 'patch_log'); await real.applyMigrationFile(file) } }
      })
      vi.stubEnv('DATABASE_URL', scratch.url)
      const { rehearse } = await import('../src/migrate-rehearse')
      const { sql: reporting } = await import('../src/db')
      vi.unstubAllEnvs()
      const lines: string[] = []
      const log = console.log
      try {
        await rehearse((line) => lines.push(line), { allowLive: true })
      } finally {
        vi.doUnmock('../src/migrate')
        await reporting.end({ timeout: 5 })
      }
      expect(lines.slice(1, 4)).toEqual([
        `adopted the baseline: recorded ${ADOPTED_WITH_BASELINE.join(', ')} without running them`,
        'dropped patch_log',
        'applied 0143_drop_patch_log.sql',
      ])
      expect(console.log).toBe(log)
    } finally {
      await scratch.close()
    }
  }, 120_000)

  it('a database the migrator refuses is refused, as the migrator refuses it', async () => {
    const scratch = await scratchDatabase(`create table public.migration (name text primary key, applied_at timestamptz not null default now());
      insert into public.migration (name) values ('0001_init.sql')`)
    try {
      await expect(rehearseOn(scratch)).rejects.toThrow('Refusing to migrate: this database records its migrations in public.migration')
    } finally {
      await scratch.close()
    }
  }, 60_000)

  // #558: a restored copy has no other sessions; a live instance always has
  // its server's. The rehearsal holds each change's locks until it ends, so
  // pointed at a live database it would block the instance's users.
  it('a database another session is connected to is refused before anything runs, unless --allow-live', async () => {
    const scratch = await scratchInstalledBeforeBaseline()
    try {
      await expect(rehearseOn(scratch, false)).rejects.toThrow(
        /^Refusing to rehearse: 1 other session is connected to this database, so it looks like a live instance, not a restored copy\./,
      )
      await expect(rehearseOn(scratch, false)).rejects.toThrow('pass --allow-live if you truly mean it')
      expect(await rehearseOn(scratch, true)).toContain('applied 0143_drop_patch_log.sql')
    } finally {
      await scratch.close()
    }
  }, 120_000)

  it('a copy nobody else is connected to rehearses without --allow-live', async () => {
    const scratch = await scratchInstalledBeforeBaseline()
    await scratch.db.end()
    const check = postgres(scratch.url, { max: 1, onnotice: () => {} })
    try {
      // The check connection opens only after the rehearsal, so it is alone.
      expect(await rehearseOn(scratch, false)).toContain('applied 0143_drop_patch_log.sql')
      expect(await check`select 1 from featherbase.migration where name = '0143_drop_patch_log.sql'`).toHaveLength(0)
    } finally {
      await check.end({ timeout: 5 })
      await scratch.close()
    }
  }, 120_000)

  it('a change that has to wait for a lock fails within seconds instead of queueing', async () => {
    const scratch = await scratchInstalledBeforeBaseline()
    try {
      await scratch.db.begin(async (tx) => {
        await tx`lock table featherbase.patch_log in access share mode`
        const started = Date.now()
        await expect(rehearseOn(scratch)).rejects.toThrow(
          '0143_drop_patch_log.sql waited more than 2s for a lock another session holds, so the rehearsal stopped: canceling statement due to lock timeout',
        )
        expect(Date.now() - started).toBeLessThan(10_000)
      })
      expect(await scratch.db`select to_regclass('featherbase.patch_log') as r`).toEqual([{ r: 'featherbase.patch_log' }])
    } finally {
      await scratch.close()
    }
  }, 120_000)

  it('a session connected as another role counts too', async () => {
    const role = `rehearse_other_${Date.now()}`
    const scratch = await scratchDatabase()
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
