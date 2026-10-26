// `cli people:plan` (person-rename R6, person-resolution D5): the person
// migrations rehearsed in ONE transaction that is always rolled back, with a
// printed report — the id map, the classification and scan, 0102's backfill,
// and test-mode sign-in checks. The rehearsal is driven in-process here; the
// CLI only spawns it so --rehearse can point DATABASE_URL elsewhere first.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { parsePlanOptions, rehearse, type PlanOptions } from '../src/people-plan'
import { configureDelegated, linkDelegated } from './identity-fixtures'
import { makePerson } from './fixtures'

const PLAIN: PlanOptions = { map: false, columns: false, checkSignIn: [] }

async function run(opts: Partial<PlanOptions> = {}): Promise<string> {
  const lines: string[] = []
  await rehearse({ ...PLAIN, ...opts }, (line) => lines.push(line))
  return lines.join('\n')
}

const ledger = async () => (await sql`select name from featherbase.migration order by name`).map((r) => String(r.name))

describe('people:plan options', () => {
  test('reads --map, --columns, --check-sign-in (repeatable) and --rehearse <dsn>', () => {
    expect(parsePlanOptions(['--map', '--columns', '--check-sign-in', 'RR-1', '--check-sign-in', 'rr-2', '--rehearse', 'postgres://x/y'])).toEqual({
      map: true, columns: true, checkSignIn: ['RR-1', 'rr-2'], rehearse: 'postgres://x/y',
    })
    expect(parsePlanOptions([])).toEqual({ map: false, columns: false, checkSignIn: [], rehearse: null })
  })

  test('refuses an unknown argument, the retired --resolve, and --rehearse with an empty address', () => {
    expect(() => parsePlanOptions(['--bogus'])).toThrow('people:plan: unknown argument --bogus')
    expect(() => parsePlanOptions(['--resolve', 'x.csv'])).toThrow(/--resolve is gone/)
    expect(() => parsePlanOptions(['--rehearse', ''])).toThrow('--rehearse needs a database URL')
  })
})

describe('people:plan rehearsal', () => {
  test('on a database past the re-id it rescans the recorded map and changes nothing', async () => {
    await sql`insert into person_id_map (old_id, new_id, kind) values ('OLD-PLAN-1', 'psn_planplanplanplanplan', 'person')
      on conflict (old_id) do nothing`
    const [{ n }] = await sql`select count(*)::int as n from person_id_map`
    const out = await run()
    expect(out).toContain('people:plan — rehearsal in a rolled-back transaction; pending: none')
    expect(out).toContain(`person_id_map: ${n} entries`)
    expect(out).toContain('scan: no old id in any registered column')
    expect(out).toMatch(/text columns: \d+ classified, 0 unclassified/)
    expect(out).not.toContain('UNCLASSIFIED')
    expect(out.trimEnd().endsWith('people:plan — rolled back; nothing was changed')).toBe(true)
  })

  test('the scan names an old id written back into a registered column', async () => {
    await sql`insert into person_id_map (old_id, new_id, kind) values ('OLD-PLAN-2', 'psn_planplanplanplanpla2', 'person')
      on conflict (old_id) do nothing`
    await sql`insert into comment (row_id, created_by, updated_by, ref_table, ref_name, content) values
      ('c-plan', 'OLD-PLAN-2', 'Administrator', 'Person', 'Administrator', 'regression')`
    const out = await run({ columns: true })
    expect(out).toContain('scan: featherbase.comment.created_by 1')
    // --columns prints every classified column with its class.
    expect(out).toContain('  featherbase.comment.created_by: id — history')
  })

  test('pending person migrations are rehearsed and reported, then rolled back with the ledger untouched', async () => {
    await sql`delete from featherbase.migration where name in ('0101_person_rename.ts', '0101a_service_account_name_unique.sql', '0102_person_resolution.ts')`
    const before = await ledger()
    const out = await run({ map: true })
    expect(out).toContain('pending: 0101_person_rename.ts, 0101a_service_account_name_unique.sql, 0102_person_resolution.ts')
    // 0101 finds person already in place and says so; 0101a is applied as a plain file.
    expect(out).toContain('person-rename: already applied')
    expect(out).toContain('applied 0101a_service_account_name_unique.sql')
    expect(out).toContain('person-resolution plan (0102, Phase 1a-i)')
    // With 0101 pending there is no separate rescan: its own report covers it.
    expect(out).not.toContain('person_id_map:')
    expect(await ledger()).toEqual(before)
  })

  test('--check-sign-in tries each code through test mode at every delegated method', async () => {
    await configureDelegated()
    const devi = await makePerson({ full_name: 'Plan Devi' })
    await linkDelegated(devi, 'plan_devi', { subject: 'RR-7101' })
    const out = await run({ checkSignIn: ['rr-7101', 'RR-0000'] })
    expect(out).toContain(`test-mode sign-in by code rr-7101 via stylehr: OK → ${devi}`)
    expect(out).toMatch(/test-mode sign-in by code RR-0000 via stylehr: REFUSED \(.+\)/)
  })
})
