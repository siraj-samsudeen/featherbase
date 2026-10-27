// `cli migrate:rehearse`: every pending migration in ONE transaction that is
// always rolled back, with what each reported. The rehearsal is driven
// in-process here; the CLI only spawns it so --database-url can point
// DATABASE_URL elsewhere first (cli.test.ts).
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { parseRehearseOptions, rehearse } from '../src/migrate-rehearse'

async function run(): Promise<string> {
  const lines: string[] = []
  await rehearse((line) => lines.push(line))
  return lines.join('\n')
}

const ledger = async () => (await sql`select name from featherbase.migration order by name`).map((r) => String(r.name))

describe('migrate:rehearse options', () => {
  test('reads --database-url <dsn>; without it the rehearsal is against this database', () => {
    expect(parseRehearseOptions(['--database-url', 'postgres://x/y'])).toEqual({ databaseUrl: 'postgres://x/y' })
    expect(parseRehearseOptions([])).toEqual({ databaseUrl: null })
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
