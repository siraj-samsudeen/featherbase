// person-resolution D3/D4/D9 (Phase 1a-i): a person keeps every identifier
// they have had, with its period and source; values are tidied by their
// system's rule; restricted values are shown only to restricted readers and
// hidden ones never in a panel; who may change a value follows its system.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { normaliseValue, verhoeffValid } from '../src/identifiers'
import { addIdentifier, deleteIdentifier, listIdentifiers, updateIdentifier } from '../src/person-identifiers'
import { applySeedPack } from '../src/seed-packs'
import { makePerson } from './fixtures'

const ROSTER = { internal: { source: 'stylehr-roster-sync', verified: true } }

describe('normalising', () => {
  test('codes are upper-cased, addresses lower-cased, Indian mobiles canonical; national IDs need a valid check digit', () => {
    expect(normaliseValue(' rr-10353 ', 'upper')).toBe('RR-10353')
    expect(normaliseValue(' Siraj@Jeyarama.COM', 'lower')).toBe('siraj@jeyarama.com')
    for (const typed of ['98470 12345', '+91 98470-12345', '098470 12345', '919847012345'])
      expect(normaliseValue(typed, 'indian-mobile')).toBe('+919847012345')
    expect(() => normaliseValue('12345', 'indian-mobile')).toThrow(/10 digits/)
    expect(verhoeffValid('234123412346')).toBe(true)
    expect(verhoeffValid('234123412345')).toBe(false)
    expect(normaliseValue('2341 2341 2346', 'digits', 'national-id')).toBe('234123412346')
    expect(() => normaliseValue('2341 2341 2345', 'digits', 'national-id')).toThrow(/check digit/)
  })
})

describe('identifiers with history', () => {
  test('an agency code that became a company code: both kept, each with its period; two live employments are allowed', async () => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'A. Kumar' })
    await addIdentifier(p, { system: 'stylehr-employee-code', assigner: '7', value: '21654', valid_from: '2024-06-01', valid_to: '2026-03-03', worker_type: 'Agency' }, 'sync', ROSTER)
    await addIdentifier(p, { system: 'stylehr-employee-code', assigner: '12', value: 'rr-10353', valid_from: '2026-03-03', worker_type: 'Regular' }, 'sync', ROSTER)
    await addIdentifier(p, { system: 'stylehr-employee-code', assigner: '9', value: 'J11350', valid_from: '2026-04-01' }, 'sync', ROSTER)
    const rows = await listIdentifiers(p, 'Administrator')
    expect(rows.filter((r) => r.system === 'stylehr-employee-code').map((r) => [r.value, r.assigner, r.valid_from, r.valid_to, r.current, r.worker_type])).toEqual([
      ['J11350', '9', '2026-04-01', null, true, null],
      ['RR-10353', '12', '2026-03-03', null, true, 'Regular'],
      ['21654', '7', '2024-06-01', '2026-03-03', false, 'Agency'],
    ])
  })

  test('one holder at a time, scoped by assigner: an overlapping holder is refused; another firm, or a later spell, is not', async () => {
    await applySeedPack('jeyarama')
    const a = await makePerson({ full_name: 'A' })
    const b = await makePerson({ full_name: 'B' })
    await addIdentifier(a, { system: 'stylehr-employee-code', assigner: '12', value: 'RR-1', valid_from: '2025-01-01', valid_to: '2026-01-01' }, 'sync', ROSTER)
    const overlap = addIdentifier(b, { system: 'stylehr-employee-code', assigner: '12', value: 'rr-1', valid_from: '2025-06-01' }, 'sync', ROSTER)
    await expect(overlap).rejects.toMatchObject({ type: 'ConflictError', fields: { code: 'overlap' } })
    // The error never echoes the value.
    await expect(overlap).rejects.not.toThrow(/RR-1/)
    await expect(addIdentifier(b, { system: 'stylehr-employee-code', assigner: '7', value: 'RR-1', valid_from: '2025-06-01' }, 'sync', ROSTER)).resolves.toMatchObject({ result: 'created' })
    // Half-open: the next spell may start on the day the last one ended.
    await expect(addIdentifier(b, { system: 'stylehr-employee-code', assigner: '12', value: 'RR-1', valid_from: '2026-01-01' }, 'sync', ROSTER)).resolves.toMatchObject({ result: 'created' })
  })

  test('saving the same current value again changes and records nothing', async () => {
    const p = await makePerson({ full_name: 'Same' })
    const first = await addIdentifier(p, { system: 'phone', value: '98470 12345' }, 'Administrator')
    const [{ n: before }] = await sql`select count(*)::int as n from activity_log where operation like ${'identifier_%' + p + '%'}`
    const again = await addIdentifier(p, { system: 'phone', value: '+91 98470 12345' }, 'Administrator')
    expect(again).toMatchObject({ result: 'unchanged', identifier: { id: first.identifier.id } })
    const [{ n: after }] = await sql`select count(*)::int as n from activity_log where operation like ${'identifier_%' + p + '%'}`
    expect(after).toBe(before)
  })

  test('a person updates their own phone: today is its start, the old one stays as history, and it is not verified', async ({ createUser }) => {
    const me = await createUser({ email: 'own.phone@x.test' })
    const first = (await me.post<{ identifier: { id: string } }>(`/api/people/${me.user}/identifiers`, { system: 'phone', value: '9847012345' }))
    await me.fetch(`/api/identifiers/${first.identifier.id}`, { method: 'PATCH', body: JSON.stringify({ valid_to: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) }) })
    const second = await me.post<{ identifier: { valid_from: string; verified: boolean } }>(`/api/people/${me.user}/identifiers`, { system: 'phone', value: '9847099999' })
    expect(second.identifier).toMatchObject({ valid_from: new Date().toISOString().slice(0, 10), verified: false })
    const own = await me.get<{ identifiers: { value: string; current: boolean }[] }>(`/api/people/${me.user}/identifiers`)
    expect(own.identifiers.filter((i) => i.value?.startsWith('+91')).map((i) => i.value).sort()).toEqual(['+919847012345', '+919847099999'])
  })

  test('a value fed by the HR roster is corrected there, not here — even by a System Manager', async ({ admin }) => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'Fed' })
    const { identifier } = await addIdentifier(p, { system: 'stylehr-employee-code', value: 'RR-9' }, 'sync', ROSTER)
    const res = await admin.fetch(`/api/identifiers/${identifier.id}`, { method: 'PATCH', body: JSON.stringify({ valid_to: '2030-01-01' }) })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/comes from stylehr-roster-sync; correct it there/)
    await expect(admin.post(`/api/people/${p}/identifiers`, { system: 'stylehr-employee-code', value: 'RR-10' })).rejects.toMatchObject({ status: 403 })
  })

  test('a code row points at the HR record it belongs to; a record of someone else is refused', async () => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'Rec' })
    const other = await makePerson({ full_name: 'Other' })
    const rec = await addIdentifier(p, { system: 'stylehr-employee-id', value: '48213' }, 'sync', ROSTER)
    const theirs = await addIdentifier(other, { system: 'stylehr-employee-id', value: '31177' }, 'sync', ROSTER)
    await expect(addIdentifier(p, { system: 'stylehr-employee-code', value: 'RR-1', record_identifier_id: rec.identifier.id }, 'sync', ROSTER)).resolves.toMatchObject({
      identifier: { record_identifier_id: rec.identifier.id },
    })
    await expect(addIdentifier(p, { system: 'stylehr-employee-code', value: 'RR-2', record_identifier_id: theirs.identifier.id }, 'sync', ROSTER)).rejects.toMatchObject({ type: 'ValidationError' })
  })
})

describe('ending and removing (Codex review on #385)', () => {
  test('an end date before the start is refused and the history kept; an end on the start day removes a value never in force', async () => {
    const p = await makePerson({ full_name: 'Typo' })
    const { identifier } = await addIdentifier(p, { system: 'phone', value: '9847012345', valid_from: '2025-01-01' }, 'Administrator')
    await expect(updateIdentifier(identifier.id, { valid_to: '2024-12-31' }, 'Administrator')).rejects.toMatchObject({ type: 'ValidationError', fields: { valid_to: expect.any(String) } })
    expect(await sql`select lower(valid)::text as starts from person_identifier where id = ${identifier.id}`).toEqual([{ starts: '2025-01-01' }])
    await updateIdentifier(identifier.id, { valid_to: '2025-01-01' }, 'Administrator')
    expect(await sql`select 1 from person_identifier where id = ${identifier.id}`).toHaveLength(0)
  })

  test('a replaced record’s identifiers cannot be deleted', async () => {
    const survivor = await makePerson({ full_name: 'Kept' })
    const loser = await makePerson({ full_name: 'Merged away' })
    const { identifier } = await addIdentifier(loser, { system: 'phone', value: '9847012345' }, 'Administrator')
    await sql`update person set enabled = false, replaced_by = ${survivor} where row_id = ${loser}`
    await expect(deleteIdentifier(identifier.id, 'Administrator')).rejects.toMatchObject({ type: 'ConflictError', fields: { code: 'replaced_by' } })
    expect(await sql`select 1 from person_identifier where id = ${identifier.id}`).toHaveLength(1)
  })
})

describe('who sees what', () => {
  test('restricted values are shown only to restricted readers; hidden ones never in a panel, but found by exact value', async ({ admin, createUser }) => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'Shown', email: 'shown@x.test' })
    await addIdentifier(p, { system: 'phone', value: '9847012345' }, 'Administrator')
    await addIdentifier(p, { system: 'stylehr-employee-id', value: '48213' }, 'sync', ROSTER)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Person Reader' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: 'Person Reader', can_read: true } })
    const reader = await createUser({ email: 'reader@x.test', roles: ['Person Reader'] })
    const plain = await reader.get<{ identifiers: { system: string }[] }>(`/api/people/${p}/identifiers`)
    expect(plain.identifiers.map((i) => i.system)).toEqual(['email'])
    const full = await admin.get<{ identifiers: { system: string; value: string }[] }>(`/api/people/${p}/identifiers`)
    expect(full.identifiers.map((i) => [i.system, i.value]).sort()).toEqual([['email', 'shown@x.test'], ['phone', '+919847012345']])
    // A Data Quality Manager reads the restricted tier.
    const dqm = await createUser({ email: 'dqm@x.test', roles: ['Person Reader', 'Data Quality Manager'] })
    expect((await dqm.get<{ identifiers: { system: string }[] }>(`/api/people/${p}/identifiers`)).identifiers.map((i) => i.system).sort()).toEqual(['email', 'phone'])
    // Hidden values: searchable by exact value, by restricted readers only.
    expect((await admin.get<{ people: { person_id: string }[] }>('/api/identifiers?system=stylehr-employee-id&value=48213')).people.map((x) => x.person_id)).toEqual([p])
    await expect(reader.get('/api/identifiers?system=stylehr-employee-id&value=48213')).rejects.toMatchObject({ status: 403 })
    expect((await reader.get<{ people: { person_id: string }[] }>('/api/identifiers?system=email&value=SHOWN@x.test')).people.map((x) => x.person_id)).toEqual([p])
  })
})

describe('built-in and replaced records', () => {
  test('a built-in account gets no identifiers; a replaced record refuses writes and is left out of pickers', async ({ admin }) => {
    await expect(addIdentifier('Administrator', { system: 'phone', value: '9847012345' }, 'Administrator')).rejects.toMatchObject({ fields: { code: 'built_in' } })
    const survivor = await makePerson({ full_name: 'Survivor' })
    const loser = await makePerson({ full_name: 'Loser' })
    await sql`update person set enabled = false, replaced_by = ${survivor} where row_id = ${loser}`
    await expect(addIdentifier(loser, { system: 'phone', value: '9847012345' }, 'Administrator')).rejects.toMatchObject({ type: 'ConflictError', fields: { code: 'replaced_by' } })
    await expect(sql.begin((tx) => tx`update person set enabled = true where row_id = ${loser}`)).rejects.toThrow(/person_replaced_is_disabled/)
    // The Person picker's filter: not built-in, not replaced.
    const filters = encodeURIComponent(JSON.stringify([['built_in', '=', false], ['replaced_by', '=', null], ['full_name', 'in', ['Survivor', 'Loser']]]))
    const listed = await admin.get<{ data: { row_id: string }[] }>(`/api/table/Person?filters=${filters}`)
    expect(listed.data.map((r) => r.row_id)).toEqual([survivor])
  })
})
