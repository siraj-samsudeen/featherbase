// person-resolution D2: identifier systems are configuration with sensible
// defaults — the kind fills in every setting, Sensitivity decides storage,
// display and tier together, and settings that would defeat the system are
// refused. Generic rows ship with core; Jeyarama's arrive as a seed pack.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { kindPreset, assuranceOf } from '../src/identifiers'
import { applySeedPack } from '../src/seed-packs'
import { addIdentifier } from '../src/person-identifiers'
import { CORE_PEOPLE_REVIEW } from '../src/person-identifiers'
import { makePerson } from './fixtures'

const system = async (key: string) => (await sql`select * from identifier_system where row_id = ${key}`)[0]

describe('identifier systems: presets and Sensitivity', () => {
  test('core ships phone and email; phone is Restricted, email Normal, both point out duplicates', async () => {
    expect(await system('phone')).toMatchObject({
      kind: 'contact', normalise: 'indian-mobile', match: 'Suggest', sensitivity: 'Restricted', one_holder_at_a_time: false,
      storage: 'plain', display: 'full', tier: 'restricted', edited_by: 'self', enabled: true,
    })
    expect(await system('email')).toMatchObject({ kind: 'contact', normalise: 'lower', sensitivity: 'Normal', tier: 'basic' })
    const [settings] = await sql`select value from single_value where table_name = 'System Settings' and field = 'people_review'`
    expect(JSON.parse(String(settings.value))).toEqual(CORE_PEOPLE_REVIEW)
  })

  test('the kind fills in every setting left unsaid, and each can be overridden', async ({ admin }) => {
    await admin.post('/api/save_row', { table: 'Identifier System', row: { row_id: 'probe-code', label: 'Probe code', kind: 'employee-record' } })
    expect(await system('probe-code')).toMatchObject({
      normalise: 'upper', one_holder_at_a_time: true, one_per_person: false, assigner_scoped: true, match: 'Off',
      sensitivity: 'Normal', edited_by: 'source', storage: 'plain', display: 'full', tier: 'basic',
    })
    await admin.post('/api/save_row', {
      table: 'Identifier System',
      row: { row_id: 'probe-record', label: 'Probe record', kind: 'external-record', normalise: 'upper' },
    })
    expect(await system('probe-record')).toMatchObject({ normalise: 'upper', sensitivity: 'Restricted, hidden', display: 'hidden', tier: 'restricted' })
    expect(kindPreset('national-id')).toMatchObject({ normalise: 'digits', one_holder_at_a_time: false, one_per_person: true, match: 'Suggest', sensitivity: 'Secret' })
    expect(assuranceOf('national-id')).toBe('strong')
    expect(assuranceOf('contact')).toBe('weak')
  })

  test('a setting that would defeat duplicate detection is refused, with the reason', async ({ admin }) => {
    await expect(
      admin.post('/api/save_row', {
        table: 'Identifier System',
        row: { row_id: 'probe-dup', label: 'Probe', kind: 'contact', match: 'Suggest', one_holder_at_a_time: true },
      }),
    ).rejects.toMatchObject({ status: 417, message: expect.stringMatching(/second holder/) })
  })

  test('Secret is for national IDs only and is always fingerprint / last four / restricted', async ({ admin }) => {
    await expect(
      admin.post('/api/save_row', { table: 'Identifier System', row: { row_id: 'probe-secret', label: 'P', kind: 'contact', sensitivity: 'Secret', match: 'Off' } }),
    ).rejects.toMatchObject({ status: 417 })
    await admin.post('/api/save_row', { table: 'Identifier System', row: { row_id: 'probe-nid', label: 'National', kind: 'national-id' } })
    expect(await system('probe-nid')).toMatchObject({ sensitivity: 'Secret', storage: 'fingerprint', display: 'last4', tier: 'restricted' })
    // No value is stored until fingerprinting exists (Phase 1b): refused per row.
    const person = await makePerson({ email: 'nid@x.test' })
    await expect(addIdentifier(person, { system: 'probe-nid', value: '234123412346' }, 'Administrator')).rejects.toMatchObject({
      fields: { code: 'fingerprint_unavailable' },
    })
  })

  test('a system with values cannot be deleted; a uniqueness flag cannot be turned on over duplicates; flag changes re-stamp rows', async ({ admin }) => {
    await admin.post('/api/save_row', { table: 'Identifier System', row: { row_id: 'probe-badge', label: 'Badge', kind: 'contact', match: 'Off', edited_by: 'system-manager' } })
    const a = await makePerson({ email: 'badge.a@x.test' })
    const b = await makePerson({ email: 'badge.b@x.test' })
    await addIdentifier(a, { system: 'probe-badge', value: 'B-1' }, 'Administrator')
    await addIdentifier(b, { system: 'probe-badge', value: 'b-1' }, 'Administrator')
    await expect(admin.delete('/api/table/Identifier%20System/probe-badge')).rejects.toMatchObject({ status: 409 })
    const row = await admin.get<{ updated_at: string }>('/api/table/Identifier%20System/probe-badge')
    const turnOn = await admin.fetch('/api/table/Identifier%20System/probe-badge', {
      method: 'PATCH', body: JSON.stringify({ one_holder_at_a_time: true, updated_at: row.updated_at }),
    })
    expect(turnOn.status).toBe(409)
    // One per person, with no duplicates: allowed, and every row is re-stamped.
    const again = await admin.get<{ updated_at: string }>('/api/table/Identifier%20System/probe-badge')
    const perPerson = await admin.fetch('/api/table/Identifier%20System/probe-badge', {
      method: 'PATCH', body: JSON.stringify({ one_per_person: true, updated_at: again.updated_at }),
    })
    expect(perPerson.status).toBe(200)
    expect(await sql`select distinct one_per_person from person_identifier where system = 'probe-badge'`).toEqual([{ one_per_person: true }])
  })
})

describe('the Jeyarama seed pack', () => {
  test('adds the StyleHR systems, links the StyleHR sign-in to its record numbers, sets people_review; applying it again changes nothing', async () => {
    await sql`insert into sign_in_method (row_id, kind, label, enabled, new_person) values ('stylehr', 'delegated_password', 'StyleHR', false, 'refuse')
      on conflict (row_id) do nothing`
    const first = await applySeedPack('jeyarama')
    expect(first.added.sort()).toEqual(['stylehr-employee-code', 'stylehr-employee-id'])
    expect(first.methodsLinked).toEqual(['stylehr'])
    expect(await system('stylehr-employee-id')).toMatchObject({ kind: 'external-record', sensitivity: 'Restricted, hidden', display: 'hidden', source: 'stylehr-roster-sync' })
    expect(await system('stylehr-employee-code')).toMatchObject({ kind: 'employee-record', assigner_scoped: true, one_holder_at_a_time: true, sensitivity: 'Normal' })
    const [settings] = await sql`select value from single_value where table_name = 'System Settings' and field = 'people_review'`
    expect(JSON.parse(String(settings.value)).compare_columns).toContain('worker_type_from_roster')
    const again = await applySeedPack('jeyarama')
    expect(again).toMatchObject({ added: [], methodsLinked: [], peopleReview: 'kept' })
    expect(again.kept.sort()).toEqual(['stylehr-employee-code', 'stylehr-employee-id'])
  })
})
