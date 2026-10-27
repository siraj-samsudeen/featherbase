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
import { formatResolutionPlan, migratePersonResolution } from '../src/person-resolution-migration'
import { configureDelegated, giveEmployeeCode, linkDelegated } from './identity-fixtures'
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

  test('a sign-in already on its record number is checked by the person’s current code; one with no code is listed', async () => {
    await devShape()
    const recorded = await makePerson({ full_name: 'Recorded Rani' })
    const uncoded = await makePerson({ full_name: 'Uncoded Uma' })
    for (const [person, record] of [[recorded, '900777'], [uncoded, '900778']]) {
      await sql`insert into person_identifier (id, person_id, system, value, one_holder, source, recorded_by)
        values (${'pid_rec' + record + 'aaaaaaaaaaaaaa'}, ${person}, 'stylehr-employee-id', ${record}, true, 'test', 'test')`
      await sql`insert into sign_in_identity (id, person_id, method, subject, subject_kind, linked_by)
        values (${'uid_rec' + record}, ${person}, 'stylehr', ${record}, 'record-id', 'test')`
    }
    await giveEmployeeCode(recorded, 'RR-0777')
    const plan = await migratePersonResolution()
    // Neither is moved back to a code: each is already on its record number.
    expect(plan.keptByCode).toBe(4)
    expect(await sql`select subject_kind from sign_in_identity where id in ('uid_rec900777', 'uid_rec900778')`).toEqual([
      { subject_kind: 'record-id' }, { subject_kind: 'record-id' },
    ])
    expect(plan.parity.liveStyleHrSignIns).toBe(6)
    expect(plan.parity.keepWorking).toBe(5)
    expect(plan.parity.failing).toEqual([{ person: uncoded, full_name: 'Uncoded Uma', detail: 'test-mode sign-in by (no code): no current employee code' }])
  })

  test('the printed plan lists the pack, the counts, shared codes and the sign-ins test mode would not find', async () => {
    const p = await devShape()
    await linkDelegated(p.twinA, 'twin_login', { subject: 'DUP-1' })
    await sql`delete from person_identifier where person_id = ${p.twinA}`
    const text = formatResolutionPlan(await migratePersonResolution())
    expect(text).toMatch(/^person-resolution plan \(0102, Phase 1a-i\)\n  Jeyarama seed pack applied: yes \(.*jeyarama.*\)$/m)
    expect(text).toContain('  employee-code rows written (assigner \'\'): 4')
    expect(text).toContain('  email rows written: 1')
    expect(text).toContain('  StyleHR sign-ins marked as keyed by employee code: 4 (record numbers: run `cli people:resolve <csv>` after the deploy)')
    expect(text).toContain(`  employee codes on 2+ people here (no row written): 2`)
    expect(text).toContain(`    twinA (${p.twinA}) — employee code DUP-1 is on 2 people`)
    expect(text).toContain('  PARITY (test mode\'s own lookup): 5 StyleHR sign-ins work today; 4 still find the same person by code')
    expect(text).toContain(`  StyleHR sign-ins test mode would NOT find: 1\n    twinA (${p.twinA}) — test-mode sign-in by DUP-1:`)
    const none = formatResolutionPlan({ seedPackApplied: false, codeRows: 0, emailRows: 0, keptByCode: 0, sharedCodes: [],
      parity: { liveStyleHrSignIns: 0, keepWorking: 0, failing: [{ person: 'psn_x', full_name: null, detail: 'why' }] } })
    expect(none).toContain('  Jeyarama seed pack applied: no (no Jeyarama data)')
    expect(none).toContain('  employee codes on 2+ people here (no row written): 0 none')
    expect(none).toContain('    psn_x — why')
  })
})

// The database 0102 ran on: no Identifier System Table, no identifier
// tables, no history constraints, and none of 0102's metadata columns.
async function pre0102Shape() {
  await sql.unsafe(`
    drop table featherbase.person_merge, featherbase.person_match_member, featherbase.person_match,
      featherbase.person_identifier_fingerprint, featherbase.person_identifier, featherbase.identifier_system cascade;
    alter table featherbase.person drop constraint person_replaced_by_fkey, drop constraint person_replaced_is_disabled;
    alter table featherbase.sign_in_identity drop constraint sign_in_identity_ended_reason, drop constraint sign_in_identity_subject_kind;
  `)
  await sql`delete from column_def where parent = 'Identifier System'`
  await sql`delete from table_def where name = 'Identifier System'`
  await sql`delete from column_def where (parent, column_name) in (('Person', 'replaced_by'), ('Sign In Method', 'identifier_system'), ('System Settings', 'people_review'))`
  invalidateMeta()
}

describe('migration 0102 from the pre-0102 database', () => {
  test('creates the Identifier System Table with phone and email, the identifier tables and their constraints', async () => {
    await pre0102Shape()
    // No StyleHR method here, so no Jeyarama pack: only the generic systems.
    const plan = await migratePersonResolution()
    expect(plan.seedPackApplied).toBe(false)
    expect(await sql`select row_id, sensitivity from identifier_system where row_id in ('phone', 'email') order by row_id`).toEqual([
      { row_id: 'email', sensitivity: 'Normal' }, { row_id: 'phone', sensitivity: 'Restricted' },
    ])
    expect(await sql`select title_column, system from table_def where name = 'Identifier System'`).toEqual([{ title_column: 'label', system: true }])
    for (const name of ['person_identifier_person_id_fkey', 'person_identifier_system_fkey', 'person_identifier_record_fkey', 'person_identifier_one_holder',
      'person_match_member_person_fkey', 'person_replaced_by_fkey', 'person_replaced_is_disabled', 'sign_in_identity_ended_reason', 'sign_in_identity_subject_kind'])
      expect(await sql`select 1 from pg_constraint where conname = ${name}`, name).toHaveLength(1)
    expect(await sql`select parent, column_name, column_type, reference_table from column_def
      where (parent, column_name) in (('Person', 'replaced_by'), ('Sign In Method', 'identifier_system'), ('System Settings', 'people_review'))
      order by parent`).toEqual([
      { parent: 'Person', column_name: 'replaced_by', column_type: 'Reference', reference_table: 'Person' },
      { parent: 'Sign In Method', column_name: 'identifier_system', column_type: 'Reference', reference_table: 'Identifier System' },
      { parent: 'System Settings', column_name: 'people_review', column_type: 'JSON', reference_table: null },
    ])
    // The history constraint holds: a replaced record must be disabled.
    const a = await makePerson({ full_name: 'Survivor' })
    const b = await makePerson({ full_name: 'Replaced' })
    await expect(sql.begin(() => sql`update person set replaced_by = ${a} where row_id = ${b}`)).rejects.toThrow(/person_replaced_is_disabled/)
  })
})

