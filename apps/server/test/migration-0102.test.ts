// Migration 0102 (person-resolution Phase 1a-i) against a dev-shaped fixture:
// trial staff with an `employee_code` Custom Field and StyleHR sign-ins keyed
// by that code. 0102 writes code and email rows and marks every StyleHR
// sign-in as keyed by employee code; it reads no resolve file (review
// decision — that is `cli people:resolve`, people-resolve.test.ts). Parity
// is proven through test mode's own lookup. Nothing is merged.
import { describe, expect, vi, afterEach } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { migratePersonResolution } from '../src/person-resolution-migration'
import { configureDelegated, linkDelegated } from './identity-fixtures'
import { makePerson } from './fixtures'

afterEach(() => vi.unstubAllEnvs())

async function devShape() {
  await configureDelegated()
  await sql.unsafe(`alter table featherbase.person add column if not exists employee_code varchar(140)`)
  invalidateMeta()
  const people: Record<string, string> = {}
  for (const [key, code, email] of [
    ['devi', 'RR-0101', 'sm.atk@jeyarama.com'],
    ['kumar', '30654', null],
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
  for (const key of ['devi', 'kumar', 'collide', 'missing'] as const) {
    const [code] = await sql`select employee_code from person where row_id = ${people[key]}`
    const id = await linkDelegated(people[key], `${key}_login`, { subject: String(code.employee_code) })
    await sql`update sign_in_identity set subject_kind = 'record-id' where id = ${id}`
  }
  await sql`delete from person_identifier where person_id in ${sql(Object.values(people))}`
  return people
}

describe('migration 0102: identifiers from the dev roster', () => {
  test('code and email rows are written; every StyleHR sign-in is kept by its employee code', async () => {
    const p = await devShape()
    const plan = await migratePersonResolution()
    expect(plan.seedPackApplied).toBe(true)
    expect(plan.keptByCode).toBe(4)
    expect(plan.sharedCodes.map((x) => x.person).sort()).toEqual([p.twinA, p.twinB].sort())

    const subject = async (person: string) =>
      (await sql`select subject, subject_kind from sign_in_identity where person_id = ${person} and method = 'stylehr'`)[0]
    expect(await subject(p.devi)).toEqual({ subject: 'RR-0101', subject_kind: 'employee-code' })
    expect(await subject(p.kumar)).toEqual({ subject: '30654', subject_kind: 'employee-code' })

    // Code rows (assigner ''), no record numbers yet; email rows.
    expect(await sql`
      select system, assigner, value, verified, record_identifier_id from person_identifier
      where person_id = ${p.devi} order by system`).toEqual([
      { system: 'email', assigner: '', value: 'sm.atk@jeyarama.com', verified: true, record_identifier_id: null },
      { system: 'stylehr-employee-code', assigner: '', value: 'RR-0101', verified: true, record_identifier_id: null },
    ])
    expect(await sql`select 1 from person_identifier where system = 'stylehr-employee-id' and person_id in ${sql(Object.values(p))}`).toHaveLength(0)
    expect(await sql`select 1 from person_identifier where person_id in (${p.twinA}, ${p.twinB})`).toHaveLength(0)
  })

  test('parity is computed through test mode’s own lookup, and a sign-in it would not find is listed', async () => {
    const p = await devShape()
    // twinA shares a code with twinB, so no code row is written for either:
    // test mode cannot find twinA by code, and the plan must say so.
    await linkDelegated(p.twinA, 'twin_login', { subject: 'DUP-1' })
    await sql`delete from person_identifier where person_id = ${p.twinA}`
    const plan = await migratePersonResolution()
    expect(plan.parity.liveStyleHrSignIns).toBe(5)
    expect(plan.parity.keepWorking).toBe(4)
    expect(plan.parity.failing.map((x) => x.person)).toEqual([p.twinA])
    expect(plan.parity.failing[0].detail).toMatch(/DUP-1/)
  })

  test('the verified address of every live Google link is backfilled too (Codex review on #385)', async () => {
    const p = await devShape()
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
      values ('uid_backfill_g', ${p.kumar}, 'google', 'g-kumar', 'Kumar.Second@gmail.com', 'test')`
    await sql`delete from person_identifier where person_id = ${p.kumar} and system = 'email'`
    await migratePersonResolution()
    expect(await sql`select value, source from person_identifier where person_id = ${p.kumar} and system = 'email'`).toEqual([
      { value: 'kumar.second@gmail.com', source: 'sign-in' },
    ])
  })

  test('every trial sign-in keeps working in test mode, by its code in any case', async ({ api }) => {
    const p = await devShape()
    await migratePersonResolution()
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    for (const [code, person] of [['rr-0101', p.devi], ['30654', p.kumar], ['RR-9999', p.missing], ['RR-8001', p.collide]]) {
      const res = await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: code, pwd: '', method: 'stylehr' }) })
      expect(res.status, code).toBe(200)
      expect(((await res.json()) as { user: { row_id: string } }).user.row_id).toBe(person)
    }
  })

  test('running it again writes nothing new', async () => {
    await devShape()
    await migratePersonResolution()
    const again = await migratePersonResolution()
    expect(again).toMatchObject({ codeRows: 0, emailRows: 0, keptByCode: 0 })
    expect(again.parity.keepWorking).toBe(again.parity.liveStyleHrSignIns)
  })

  test('without a StyleHR method, an employee_code column alone applies no Jeyarama pack (A-m5)', async () => {
    await sql.unsafe(`alter table featherbase.person add column if not exists employee_code varchar(140)`)
    await sql`delete from sign_in_identity where method = 'stylehr'`
    await sql`delete from sign_in_method where row_id = 'stylehr'`
    invalidateMeta()
    const plan = await migratePersonResolution()
    expect(plan.seedPackApplied).toBe(false)
    expect(plan.codeRows).toBe(0)
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
})
