// Migration 0102 (person-resolution Phase 1a-i) against a dev-shaped fixture:
// trial staff with an `employee_code` Custom Field and StyleHR sign-ins keyed
// by that code, plus the warehouse's resolve file. Each StyleHR sign-in is
// rewritten to its record number when the file names exactly one record; a
// code the file lacks, or names twice (codes collide across firms), keeps
// working by code and is listed. Nothing is merged.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, vi, afterEach } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { migratePersonResolution, parseResolveFile } from '../src/person-resolution-migration'
import { configureDelegated, linkDelegated } from './identity-fixtures'
import { makePerson } from './fixtures'

afterEach(() => vi.unstubAllEnvs())

function resolveFile(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'fb-resolve-'))
  const file = join(dir, 'stylehr_record_ids.csv')
  writeFileSync(file, ['employee_code,assigner,stylehr_record_id', ...lines].join('\n'))
  return file
}

async function devShape() {
  await configureDelegated()
  await sql.unsafe(`alter table featherbase.person add column if not exists employee_code varchar(140)`)
  invalidateMeta()
  const people: Record<string, string> = {}
  for (const [key, code, email] of [
    ['anisha', 'RR-7963', 'sm.atk@jeyarama.com'],
    ['kumar', '21654', null],
    ['collide', 'RR-8001', null],
    ['missing', 'RR-9999', null],
    ['twinA', 'DUP-1', null],
    ['twinB', 'dup-1', null],
  ] as const) {
    const id = await makePerson({ full_name: key, ...(email ? { email } : {}) })
    await sql`update person set employee_code = ${code} where row_id = ${id}`
    people[key] = id
  }
  // The pre-0102 shape: identities keyed by the employee code, no code rows yet.
  await sql`delete from person_identifier where person_id in ${sql(Object.values(people))}`
  for (const key of ['anisha', 'kumar', 'collide', 'missing'] as const) {
    const [code] = await sql`select employee_code from person where row_id = ${people[key]}`
    const id = await linkDelegated(people[key], `${key}_login`, { subject: String(code.employee_code) })
    await sql`update sign_in_identity set subject_kind = 'record-id' where id = ${id}`
  }
  await sql`delete from person_identifier where person_id in ${sql(Object.values(people))}`
  return people
}

const RESOLVE = ['RR-7963,12,48213', '21654,7,31177', 'RR-8001,12,50001', 'RR-8001,7,50002']

describe('migration 0102: identifiers from the dev roster and the resolve file', () => {
  test('sign-ins move to record numbers; unresolved and colliding codes keep working and are listed', async () => {
    const p = await devShape()
    const plan = await migratePersonResolution({ resolveFile: resolveFile(RESOLVE) })
    expect(plan.seedPackApplied).toBe(true)
    expect(plan.subjectsResolved).toBe(2)
    expect(plan.recordRows).toBe(2)
    expect(plan.unresolved.map((x) => x.person)).toEqual([p.missing])
    expect(plan.colliding.map((x) => x.person)).toEqual([p.collide])
    expect(plan.sharedCodes.map((x) => x.person).sort()).toEqual([p.twinA, p.twinB].sort())
    expect(plan.parity.keepWorking).toBe(plan.parity.liveStyleHrSignIns)

    const subject = async (person: string) =>
      (await sql`select subject, subject_kind from sign_in_identity where person_id = ${person} and method = 'stylehr'`)[0]
    expect(await subject(p.anisha)).toEqual({ subject: '48213', subject_kind: 'record-id' })
    expect(await subject(p.kumar)).toEqual({ subject: '31177', subject_kind: 'record-id' })
    expect(await subject(p.collide)).toEqual({ subject: 'RR-8001', subject_kind: 'employee-code' })
    expect(await subject(p.missing)).toEqual({ subject: 'RR-9999', subject_kind: 'employee-code' })

    // Code rows (assigner ''), each pointing at its record when resolved; email rows.
    const rows = await sql`
      select i.system, i.assigner, i.value, i.verified, r.value as record
      from person_identifier i left join person_identifier r on r.id = i.record_identifier_id
      where i.person_id = ${p.anisha} order by i.system`
    expect(rows).toEqual([
      { system: 'email', assigner: '', value: 'sm.atk@jeyarama.com', verified: true, record: null },
      { system: 'stylehr-employee-code', assigner: '', value: 'RR-7963', verified: true, record: '48213' },
      { system: 'stylehr-employee-id', assigner: '', value: '48213', verified: true, record: null },
    ])
    expect(await sql`select value from person_identifier where person_id = ${p.missing}`).toEqual([{ value: 'RR-9999' }])
    expect(await sql`select 1 from person_identifier where person_id in (${p.twinA}, ${p.twinB})`).toHaveLength(0)
  })

  test('the verified address of every live Google link is backfilled too (Codex review on #385)', async () => {
    const p = await devShape()
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
      values ('uid_backfill_g', ${p.kumar}, 'google', 'g-kumar', 'Kumar.Second@gmail.com', 'test')`
    await sql`delete from person_identifier where person_id = ${p.kumar} and system = 'email'`
    await migratePersonResolution({ resolveFile: resolveFile(RESOLVE) })
    expect(await sql`select value, source from person_identifier where person_id = ${p.kumar} and system = 'email'`).toEqual([
      { value: 'kumar.second@gmail.com', source: 'sign-in' },
    ])
  })

  test('every trial sign-in keeps working in test mode: by code, resolved or not', async ({ api }) => {
    const p = await devShape()
    await migratePersonResolution({ resolveFile: resolveFile(RESOLVE) })
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    for (const [code, person] of [['rr-7963', p.anisha], ['21654', p.kumar], ['RR-9999', p.missing], ['RR-8001', p.collide]]) {
      const res = await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: code, pwd: '', method: 'stylehr' }) })
      expect(res.status, code).toBe(200)
      expect(((await res.json()) as { user: { row_id: string } }).user.row_id).toBe(person)
    }
  })

  test('without a resolve file nothing is rewritten: every StyleHR sign-in is kept by code and listed', async () => {
    await devShape()
    const plan = await migratePersonResolution({ resolveFile: null })
    expect(plan.subjectsResolved).toBe(0)
    expect(plan.unresolved.length).toBe(4)
    expect(plan.unresolved[0].detail).toMatch(/no resolve file given/)
  })

  test('running it again writes nothing new', async () => {
    await devShape()
    const file = resolveFile(RESOLVE)
    await migratePersonResolution({ resolveFile: file })
    const again = await migratePersonResolution({ resolveFile: file })
    expect(again).toMatchObject({ codeRows: 0, emailRows: 0, recordRows: 0, subjectsResolved: 0 })
    expect(again.parity.keepWorking).toBe(again.parity.liveStyleHrSignIns)
  })

  test('the DDL: btree_gist, the history constraints, live-only sign-in uniqueness', async () => {
    expect(await sql`select 1 from pg_extension where extname = 'btree_gist'`).toHaveLength(1)
    for (const name of ['person_identifier_one_holder', 'person_replaced_is_disabled', 'sign_in_identity_ended_reason'])
      expect(await sql`select 1 from pg_constraint where conname = ${name}`, name).toHaveLength(1)
    await configureDelegated()
    const a = await makePerson({ full_name: 'Ended' })
    const b = await makePerson({ full_name: 'Again' })
    const link = (id: string, person: string) =>
      sql`insert into sign_in_identity (id, person_id, method, subject, linked_by) values (${id}, ${person}, 'stylehr', 'REC-1', 'test')`
    await link('uid_rec1_a', a)
    await expect(sql.begin(() => link('uid_rec1_dup', b))).rejects.toThrow(/sign_in_identity_subject_uq/)
    await sql`update sign_in_identity set ended_at = now(), ended_reason = 'left' where id = 'uid_rec1_a'`
    // The same provider id can be linked afresh once the old link has ended.
    await expect(link('uid_rec1_b', b)).resolves.toBeTruthy()
  })

  test('the resolve file must carry its three columns', () => {
    expect(parseResolveFile('employee_code,assigner,stylehr_record_id\nRR-1,12,48213\n')).toEqual([{ employee_code: 'RR-1', assigner: '12', stylehr_record_id: '48213' }])
    expect(() => parseResolveFile('code,record\nRR-1,48213')).toThrow(/missing column employee_code/)
  })
})
