// `cli people:resolve <csv>` (person-resolution C4/D11, review decision): after
// the release, each StyleHR sign-in still keyed by its employee code moves to
// its StyleHR record number when the warehouse's file names exactly one; a code
// the file lacks or names twice, or a record already another person's, stays
// on its code and is listed. Running it again changes nothing.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { parseResolveFile, resolveStyleHrSubjects, runPeopleResolve } from '../src/people-resolve'
import { configureDelegated, linkDelegated } from './identity-fixtures'
import { makePerson } from './fixtures'

afterEach(() => vi.unstubAllEnvs())

const FILE = ['employee_code,assigner,stylehr_record_id', 'RR-0101,12,900001', '30654,7,900002', 'RR-8001,12,50001', 'RR-8001,7,50002', 'RR-5000,12,77777']

function csv(lines: string[]): string {
  const file = join(mkdtempSync(join(tmpdir(), 'fb-resolve-')), 'stylehr_record_ids.csv')
  writeFileSync(file, lines.join('\n'))
  return file
}

async function trial() {
  await configureDelegated()
  const p: Record<string, string> = {}
  for (const [key, code] of [['devi', 'RR-0101'], ['kumar', '30654'], ['collide', 'RR-8001'], ['missing', 'RR-9999'], ['taken', 'RR-5000']] as const) {
    p[key] = await makePerson({ full_name: key })
    await linkDelegated(p[key], `${key}_login`, { subject: code })
  }
  // Someone else already carries record 77777 (taken's record) as a current row.
  const holder = await makePerson({ full_name: 'holder' })
  await sql`insert into person_identifier (id, person_id, system, value, one_holder, source, recorded_by)
    values ('pid_holder77777aaaaaaaaa', ${holder}, 'stylehr-employee-id', '77777', true, 'test', 'test')`
  return p
}

describe('people:resolve', () => {
  test('moves resolvable sign-ins to the record number and lists the rest', async () => {
    const p = await trial()
    const report = await resolveStyleHrSubjects(parseResolveFile(FILE.join('\n')))
    expect(report.resolved.map((x) => x.person).sort()).toEqual([p.devi, p.kumar].sort())
    expect(report.notInFile.map((x) => x.person)).toEqual([p.missing])
    expect(report.colliding.map((x) => x.person)).toEqual([p.collide])
    expect(report.heldElsewhere.map((x) => x.person)).toEqual([p.taken])

    const subject = async (person: string) =>
      (await sql`select subject, subject_kind from sign_in_identity where person_id = ${person} and method = 'stylehr'`)[0]
    expect(await subject(p.devi)).toEqual({ subject: '900001', subject_kind: 'record-id' })
    expect(await subject(p.collide)).toEqual({ subject: 'RR-8001', subject_kind: 'employee-code' })
    expect(await subject(p.taken)).toEqual({ subject: 'RR-5000', subject_kind: 'employee-code' })

    // The record-number row is the sign-in's mirror; the code row points at it.
    expect(await sql`
      select i.system, i.value, i.source, r.value as record from person_identifier i
      left join person_identifier r on r.id = i.record_identifier_id
      where i.person_id = ${p.devi} order by i.system`).toEqual([
      { system: 'stylehr-employee-code', value: 'RR-0101', source: 'test', record: '900001' },
      { system: 'stylehr-employee-id', value: '900001', source: 'sign-in', record: null },
    ])
  })

  test('running it again changes nothing', async () => {
    await trial()
    const rows = parseResolveFile(FILE.join('\n'))
    await resolveStyleHrSubjects(rows)
    const before = await sql`select id, subject, subject_kind from sign_in_identity order by id`
    const again = await resolveStyleHrSubjects(rows)
    expect(again.resolved).toEqual([])
    expect(again.alreadyResolved).toBe(2)
    expect(await sql`select id, subject, subject_kind from sign_in_identity order by id`).toEqual(before)
  })

  test('a dry run reports and rolls back', async () => {
    const p = await trial()
    const report = await runPeopleResolve(csv(FILE), { dryRun: true })
    expect(report.resolved).toHaveLength(2)
    expect((await sql`select subject_kind from sign_in_identity where person_id = ${p.devi}`)[0].subject_kind).toBe('employee-code')
  })

  test('a resolved person still signs in by code in test mode', async ({ api }) => {
    const p = await trial()
    await runPeopleResolve(csv(FILE))
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    const res = await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'rr-0101', pwd: '', method: 'stylehr' }) })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { user: { row_id: string } }).user.row_id).toBe(p.devi)
  })

  test('the file must carry its three columns', () => {
    expect(parseResolveFile('employee_code,assigner,stylehr_record_id\nRR-1,12,900001\n')).toEqual([{ employee_code: 'RR-1', assigner: '12', stylehr_record_id: '900001' }])
    expect(() => parseResolveFile('code,record\nRR-1,900001')).toThrow(/missing column employee_code/)
  })
})
