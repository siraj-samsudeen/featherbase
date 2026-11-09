// person-resolution D3/D4/D9 (Phase 1a-i): a person keeps every identifier
// they have had, with its period and source; values are tidied by their
// system's rule; restricted values are shown only to restricted readers and
// hidden ones never in a panel; who may change a value follows its system.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { normaliseValue, verhoeffValid } from '../src/identifiers'
import { addIdentifier, addableSystems, deleteIdentifier, endIdentityIdentifiers, listIdentifiers, reconcileIdentityEmail, updateIdentifier, writeThroughIdentity } from '../src/person-identifiers'
import { applySeedPack } from '../src/seed-packs'
import { expectApiError, expectRefused, expectStatus, grantRole, makePerson } from './fixtures'
import { configureDelegated, inviteGoogleRaw, linkDelegated } from './identity-fixtures'
import { saveIdentifierSystem } from '../src/seed-packs'

const ROSTER = { internal: { source: 'stylehr-roster-sync', verified: true } }

describe('normalising', () => {
  test('a digits-normalized public system refuses letters without mutations and keeps distinct numeric values searchable', async ({ admin }) => {
    const system = 'coverage-digits'
    await admin.post('/api/save_row', { table: 'Identifier System', row: {
      row_id: system, label: 'Digits contact', kind: 'contact', normalise: 'digits', sensitivity: 'Normal', edited_by: 'system-manager',
    } })
    const { row_id: alpha } = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Person', row: { full_name: 'Digits Alpha' } })
    const { row_id: bravo } = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Person', row: { full_name: 'Digits Bravo' } })
    for (const [person, typed, value] of [[alpha, '12-03', '1203'], [bravo, '98 76', '9876']]) {
      expect(await admin.post(`/api/people/${person}/identifiers`, { system, value: typed }))
        .toMatchObject({ result: 'created', identifier: { person_id: person, system, value, verified: true } })
    }
    const snapshot = async () => ({
      system: await sql`select * from identifier_system where row_id = ${system}`,
      people: await sql`select * from person where row_id in (${alpha}, ${bravo}) order by row_id`,
      identifiers: await sql`select * from person_identifier where system = ${system} order by id`,
      audit: await sql`select * from activity_log where operation like 'identifier_%' order by row_id`,
    })
    const before = await snapshot()
    const add = await admin.fetch(`/api/people/${alpha}/identifiers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system, value: '12A' }),
    })
    await expectStatus(add, 417)
    expect(await add.json()).toEqual({ error: { type: 'ValidationError', message: 'Digits only', fields: { value: 'invalid_format' } } })
    expect(await snapshot()).toEqual(before)
    const search = await admin.fetch(`/api/identifiers?${new URLSearchParams({ system, value: '12A' })}`)
    await expectStatus(search, 417)
    expect(await search.json()).toEqual({ error: { type: 'ValidationError', message: 'Digits only', fields: { value: 'invalid_format' } } })
    expect(await snapshot()).toEqual(before)
    for (const [person, value] of [[alpha, '12 03'], [bravo, '98-76']]) {
      expect(await admin.get(`/api/identifiers?${new URLSearchParams({ system, value })}`)).toEqual({ people: [{
        person_id: person, resolved_to: person, replaced: false, current: true, assigner: '', pending_invite: false,
      }] })
    }
    expect(await snapshot()).toEqual(before)
  })

  test('a public mobile system normalizes international 0091 and ordinary prefixes without conflating numbers', async ({ admin }) => {
    const system = 'coverage-mobile'
    await admin.post('/api/save_row', { table: 'Identifier System', row: { row_id: system, label: 'Mobile contact', kind: 'contact' } })
    expect(await admin.get(`/api/table/Identifier%20System/${system}`)).toMatchObject({
      normalise: 'indian-mobile', sensitivity: 'Restricted', storage: 'plain', display: 'full', edited_by: 'self',
    })
    const { row_id: alpha } = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Person', row: { full_name: 'Mobile Alpha' } })
    const { row_id: bravo } = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Person', row: { full_name: 'Mobile Bravo' } })
    const first = await admin.post<{ identifier: { id: string } }>(`/api/people/${alpha}/identifiers`, { system, value: '00919847012345' })
    expect(first).toMatchObject({ result: 'created', identifier: { person_id: alpha, system, value: '+919847012345', verified: true } })
    expect(await admin.post(`/api/people/${bravo}/identifiers`, { system, value: '+91 98470-99999' }))
      .toMatchObject({ result: 'created', identifier: { person_id: bravo, system, value: '+919847099999', verified: true } })
    const stored = await sql`select * from person_identifier where system = ${system} order by id`
    const people = await sql`select * from person where row_id in (${alpha}, ${bravo}) order by row_id`
    const writes = await sql`select * from activity_log where operation like 'identifier_add%' order by row_id`
    for (const typed of ['00919847012345', '+91 98470-12345', '09847012345', '919847012345']) {
      expect(await admin.post(`/api/people/${alpha}/identifiers`, { system, value: typed }))
        .toMatchObject({ result: 'unchanged', identifier: { id: first.identifier.id, value: '+919847012345' } })
      expect(await admin.get(`/api/identifiers?${new URLSearchParams({ system, value: typed })}`)).toEqual({ people: [{
        person_id: alpha, resolved_to: alpha, replaced: false, current: true, assigner: '', pending_invite: false,
      }] })
    }
    expect(await admin.get(`/api/identifiers?${new URLSearchParams({ system, value: '00919847099999' })}`)).toEqual({ people: [{
      person_id: bravo, resolved_to: bravo, replaced: false, current: true, assigner: '', pending_invite: false,
    }] })
    expect(await sql`select * from person_identifier where system = ${system} order by id`).toEqual(stored)
    expect(await sql`select * from person where row_id in (${alpha}, ${bravo}) order by row_id`).toEqual(people)
    expect(await sql`select * from activity_log where operation like 'identifier_add%' order by row_id`).toEqual(writes)
  })

  test('codes are upper-cased, addresses lower-cased, Indian mobiles canonical; national IDs need a valid check digit', () => {
    expect(normaliseValue(' rr-0102 ', 'upper')).toBe('RR-0102')
    expect(normaliseValue(' Mixed Case ', 'none')).toBe(' Mixed Case ')
    expect(normaliseValue(' Mixed Case ', 'trim')).toBe('Mixed Case')
    expect(() => normaliseValue('   ', 'none')).toThrow(/value is required/)
    expect(normaliseValue(' Owner@Jeyarama.COM', 'lower')).toBe('owner@jeyarama.com')
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
  // #407: the panel's timestamps are ISO 8601 like every other time on the wire, not a locale string.
  test('a panel row carries recorded_at as an ISO 8601 instant', async () => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'T. Iso' })
    await addIdentifier(p, { system: 'stylehr-employee-code', assigner: '12', value: 'rr-20001' }, 'sync', ROSTER)
    const [row] = (await listIdentifiers(p, 'Administrator')).filter((r) => r.system === 'stylehr-employee-code')
    expect(row.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  })

  test('an agency code that became a company code: both kept, each with its period; two live employments are allowed', async () => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'A. Kumar' })
    await addIdentifier(p, { system: 'stylehr-employee-code', assigner: '7', value: '30654', valid_from: '2024-06-01', valid_to: '2026-03-03', worker_type: 'Agency' }, 'sync', ROSTER)
    await addIdentifier(p, { system: 'stylehr-employee-code', assigner: '12', value: 'rr-0102', valid_from: '2026-03-03', worker_type: 'Regular' }, 'sync', ROSTER)
    await addIdentifier(p, { system: 'stylehr-employee-code', assigner: '9', value: 'J0109', valid_from: '2026-04-01' }, 'sync', ROSTER)
    const rows = await listIdentifiers(p, 'Administrator')
    expect(rows.filter((r) => r.system === 'stylehr-employee-code').map((r) => [r.value, r.assigner, r.valid_from, r.valid_to, r.current, r.worker_type])).toEqual([
      ['J0109', '9', '2026-04-01', null, true, null],
      ['RR-0102', '12', '2026-03-03', null, true, 'Regular'],
      ['30654', '7', '2024-06-01', '2026-03-03', false, 'Agency'],
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
    const [{ tomorrow }] = await sql`select (current_date + 1)::text as tomorrow`
    await me.fetch(`/api/identifiers/${first.identifier.id}`, { method: 'PATCH', body: JSON.stringify({ valid_to: tomorrow }) })
    const second = await me.post<{ identifier: { valid_from: string; verified: boolean } }>(`/api/people/${me.user}/identifiers`, { system: 'phone', value: '9847099999' })
    const [{ today }] = await sql`select current_date::text as today`
    expect(second.identifier).toMatchObject({ valid_from: today, verified: false })
    const own = await me.get<{ identifiers: { value: string; current: boolean }[] }>(`/api/people/${me.user}/identifiers`)
    expect(own.identifiers.filter((i) => i.value?.startsWith('+91')).map((i) => i.value).sort()).toEqual(['+919847012345', '+919847099999'])
  })

  test('a value fed by the HR roster is corrected there, not here — even by a System Manager', async ({ admin }) => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'Fed' })
    const { identifier } = await addIdentifier(p, { system: 'stylehr-employee-code', value: 'RR-9' }, 'sync', ROSTER)
    const res = await admin.fetch(`/api/identifiers/${identifier.id}`, { method: 'PATCH', body: JSON.stringify({ valid_to: '2030-01-01' }) })
    await expectStatus(res, 403)
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/comes from stylehr-roster-sync; correct it there/)
    await expectRefused(admin.post(`/api/people/${p}/identifiers`, { system: 'stylehr-employee-code', value: 'RR-10' }), 403)
  })

  test('a code row points at the HR record it belongs to; a record of someone else is refused', async () => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'Rec' })
    const other = await makePerson({ full_name: 'Other' })
    const rec = await addIdentifier(p, { system: 'stylehr-employee-id', value: '900001' }, 'sync', ROSTER)
    const theirs = await addIdentifier(other, { system: 'stylehr-employee-id', value: '900002' }, 'sync', ROSTER)
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

describe('dates and audit (Codex review on #385)', () => {
  test('malformed dates and a worker type on a contact refuse the add without storing a row', async ({ admin }) => {
    const p = await makePerson({ full_name: 'Invalid input' })
    const before = await sql`select * from person_identifier where person_id = ${p} order by id`
    for (const field of ['valid_from', 'valid_to']) {
      for (const value of ['not-a-date', '2026-13-01', '2026-2-01']) {
        await expectApiError(admin.post(`/api/people/${p}/identifiers`, {
          system: 'phone', value: '9847012345', [field]: value,
        }), {
          status: 417, type: 'ValidationError', message: expect.stringContaining(`${field} must be a date (YYYY-MM-DD)`),
          fields: { [field]: 'a date' },
        })
        expect(await sql`select * from person_identifier where person_id = ${p} order by id`).toEqual(before)
      }
    }
    await expectApiError(admin.post(`/api/people/${p}/identifiers`, {
      system: 'phone', value: '9847012345', worker_type: 'Agency',
    }), {
      status: 417, type: 'ValidationError', message: expect.stringContaining('Only an employee record carries a worker type'),
      fields: { worker_type: 'not for this system' },
    })
    expect(await sql`select * from person_identifier where person_id = ${p} order by id`).toEqual(before)
  })

  test('a disabled system and an empty period refuse new values without changing history', async ({ admin }) => {
    await saveIdentifierSystem({ row_id: 'retired-contact', label: 'Retired contact', kind: 'contact', enabled: false })
    const p = await makePerson({ full_name: 'Retired contact holder' })
    const before = await sql`select * from person_identifier where person_id = ${p} order by id`
    await expectApiError(admin.post(`/api/people/${p}/identifiers`, { system: 'retired-contact', value: 'old' }), {
      status: 417, type: 'ValidationError', message: expect.stringContaining('Retired contact is turned off'), fields: { code: 'system_disabled' },
    })
    expect(await sql`select * from person_identifier where person_id = ${p} order by id`).toEqual(before)
    await expectApiError(admin.post(`/api/people/${p}/identifiers`, {
      system: 'phone', value: '9847012345', valid_from: '2025-01-01', valid_to: '2025-01-01',
    }), {
      status: 417, type: 'ValidationError', message: expect.stringContaining('The period ends before it starts'), fields: { valid_to: 'after valid_from' },
    })
    expect(await sql`select * from person_identifier where person_id = ${p} order by id`).toEqual(before)
  })

  test('correcting a spell can clear missing bounds, assigner and worker type; repeating it writes no audit', async ({ admin }) => {
    await saveIdentifierSystem({ row_id: 'manual-employment', label: 'Manual employment', kind: 'employee-record', edited_by: 'system-manager' })
    const p = await makePerson({ full_name: 'Corrected spell' })
    const { identifier } = await admin.post<{ identifier: { id: string } }>(`/api/people/${p}/identifiers`, {
      system: 'manual-employment', value: 'E-1', assigner: 'old firm', worker_type: 'Agency', valid_from: '2024-01-01', valid_to: '2025-01-01',
    })
    const patch = (body: unknown) => admin.fetch(`/api/identifiers/${identifier.id}`, { method: 'PATCH', body: JSON.stringify(body) })
    const correction = { valid_from: '', valid_to: null, assigner: null, worker_type: null, note: 'Dates unknown; firm corrected' }
    const response = await patch(correction)
    await expectStatus(response, 200)
    expect(await response.json()).toMatchObject({ result: 'updated', identifier: {
      id: identifier.id, valid_from: null, valid_to: null, assigner: '', worker_type: null, note: correction.note,
    } })
    expect(await sql`select lower_inf(valid) or lower(valid) = '-infinity'::date as unknown_start,
      upper_inf(valid) as current, assigner, worker_type, note from person_identifier where id = ${identifier.id}`)
      .toEqual([{ unknown_start: true, current: true, assigner: '', worker_type: null, note: correction.note }])
    const before = await sql`select * from person_identifier where person_id = ${p} order by id`
    const auditBefore = await sql`select * from activity_log where operation like ${'identifier_%' + p + '%'} order by row_id`
    const unchanged = await patch(correction)
    await expectStatus(unchanged, 200)
    expect(await unchanged.json()).toMatchObject({ result: 'unchanged', identifier: { id: identifier.id } })
    expect(await sql`select * from person_identifier where person_id = ${p} order by id`).toEqual(before)
    expect(await sql`select * from activity_log where operation like ${'identifier_%' + p + '%'} order by row_id`).toEqual(auditBefore)
    // Invalid corrections must preserve the corrected, unbounded spell too.
    await expectApiError(patch({ valid_from: '2026-02-30' }), {
      status: 417, type: 'ValidationError', message: expect.stringContaining('valid_from must be a date'), fields: { valid_from: 'a date' },
    })
    expect(await sql`select * from person_identifier where person_id = ${p} order by id`).toEqual(before)
  })

  test('an impossible calendar date is a field error, not a database error', async () => {
    const p = await makePerson({ full_name: 'Dates' })
    await expect(addIdentifier(p, { system: 'phone', value: '9847012345', valid_from: '2026-02-30' }, 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError', fields: { valid_from: expect.any(String) },
    })
    const { identifier } = await addIdentifier(p, { system: 'phone', value: '9847012345', valid_from: '2026-02-01' }, 'Administrator')
    await expect(updateIdentifier(identifier.id, { valid_to: '2026-04-31' }, 'Administrator')).rejects.toMatchObject({ type: 'ValidationError' })
  })

  test('a search of restricted values is recorded without the value', async ({ admin }) => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'Searched' })
    await addIdentifier(p, { system: 'stylehr-employee-id', value: '77001' }, 'sync', ROSTER)
    await admin.get('/api/identifiers?system=stylehr-employee-id&value=77001')
    const rows = await sql`select operation from activity_log where "user" = 'Administrator' and operation like 'identifier_search%' order by created_at desc limit 1`
    expect(rows).toEqual([{ operation: 'identifier_search stylehr-employee-id' }])
    expect(await sql`select 1 from activity_log where operation like '%77001%'`).toHaveLength(0)
  })
})

describe('who sees what', () => {
  test('creator-scoped identifier authority does not expose other readable people', async ({ admin, createUser }) => {
    await grantRole(admin, { table: 'Person', role: 'Contact Clerk', can_read: true, can_create: true })
    await admin.post('/api/save_row', { table: 'Permission', row: {
      ref_table: 'Person', role: 'Contact Clerk', operation: 'read_identifiers', scope_mode: 'creator',
    } })
    const clerk = await createUser({ email: 'contact-clerk@x.test', roles: ['Contact Clerk'] })
    const own = await clerk.post<{ row_id: string }>('/api/save_row', { table: 'Person', row: { full_name: 'Clerk contact' } })
    const other = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Person', row: { full_name: 'Other contact' } })
    for (const [person, phone] of [[own.row_id, '9847012345'], [other.row_id, '9847099999']]) {
      await admin.post(`/api/people/${person}/identifiers`, { system: 'phone', value: phone })
    }
    const visible = await clerk.get<{ identifiers: { system: string }[] }>(`/api/people/${own.row_id}/identifiers`)
    expect(visible.identifiers.map((identifier) => identifier.system)).toContain('phone')
    const hidden = await clerk.get<{ identifiers: { system: string }[] }>(`/api/people/${other.row_id}/identifiers`)
    expect(hidden.identifiers.map((identifier) => identifier.system)).not.toContain('phone')
    expect(await clerk.get('/api/identifiers?system=phone&value=9847012345')).toMatchObject({ people: [{ person_id: own.row_id }] })
    expect(await clerk.get('/api/identifiers?system=phone&value=9847099999')).toEqual({ people: [] })
  })

  test('restricted values are shown only to restricted readers; hidden ones never in a panel, but found by exact value', async ({ admin, createUser }) => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'Shown', email: 'shown@x.test' })
    await addIdentifier(p, { system: 'phone', value: '9847012345' }, 'Administrator')
    await addIdentifier(p, { system: 'stylehr-employee-id', value: '900001' }, 'sync', ROSTER)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Person Reader' } })
    await grantRole(admin, { table: 'Person', role: 'Person Reader', can_read: true })
    const reader = await createUser({ email: 'reader@x.test', roles: ['Person Reader'] })
    const plain = await reader.get<{ identifiers: { system: string }[] }>(`/api/people/${p}/identifiers`)
    expect(plain.identifiers.map((i) => i.system)).toEqual(['email'])
    const full = await admin.get<{ identifiers: { system: string; value: string }[] }>(`/api/people/${p}/identifiers`)
    expect(full.identifiers.map((i) => [i.system, i.value]).sort()).toEqual([['email', 'shown@x.test'], ['phone', '+919847012345']])
    // A Data Quality Manager reads the restricted tier.
    const dqm = await createUser({ email: 'dqm@x.test', roles: ['Person Reader', 'Data Quality Manager'] })
    expect((await dqm.get<{ identifiers: { system: string }[] }>(`/api/people/${p}/identifiers`)).identifiers.map((i) => i.system).sort()).toEqual(['email', 'phone'])
    // Hidden values: searchable by exact value, by restricted readers only.
    expect((await admin.get<{ people: { person_id: string }[] }>('/api/identifiers?system=stylehr-employee-id&value=900001')).people.map((x) => x.person_id)).toEqual([p])
    await expectRefused(reader.get('/api/identifiers?system=stylehr-employee-id&value=900001'), 403)
    expect((await reader.get<{ people: { person_id: string }[] }>('/api/identifiers?system=email&value=SHOWN@x.test')).people.map((x) => x.person_id)).toEqual([p])
  })
})

describe('search respects who may read people (Codex review on #385)', () => {
  test('a Secret-system search refuses unavailable fingerprinting without changing identifier data', async ({ admin, createUser }) => {
    const secret = 'search-national-id'
    const normal = 'search-normal-code'
    for (const row of [
      { row_id: secret, label: 'Search national ID', kind: 'national-id' },
      { row_id: normal, label: 'Search normal code', kind: 'contact', normalise: 'upper', sensitivity: 'Normal', edited_by: 'system-manager' },
    ]) await admin.post('/api/save_row', { table: 'Identifier System', row })
    const { row_id: person } = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person', row: { full_name: 'Search target' },
    })
    const { row_id: other } = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person', row: { full_name: 'Search other' },
    })
    await admin.post(`/api/people/${person}/identifiers`, { system: normal, value: 'Alpha-42' })
    await admin.post(`/api/people/${other}/identifiers`, { system: normal, value: 'Bravo-81' })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Boundary Person Reader' } })
    await grantRole(admin, { table: 'Person', role: 'Boundary Person Reader', can_read: true })
    const reader = await createUser({ roles: ['Boundary Person Reader'] })
    const denied = await createUser()
    const snapshot = async () => ({
      systems: await sql`select * from identifier_system where row_id in (${secret}, ${normal}) order by row_id`,
      identifiers: await sql`select * from person_identifier where person_id in (${person}, ${other}) or system = ${secret} order by id`,
      people: await sql`select * from person where row_id in (${person}, ${other}) order by row_id`,
    })
    const before = await snapshot()
    expect(before.systems.find((row) => row.row_id === secret)).toMatchObject({
      kind: 'national-id', sensitivity: 'Secret', storage: 'fingerprint', display: 'last4', tier: 'restricted',
    })
    expect(before.identifiers.map((row) => [row.person_id, row.system, row.value]))
      .toEqual(expect.arrayContaining([[person, normal, 'ALPHA-42'], [other, normal, 'BRAVO-81']]))
    expect(before.identifiers.filter((row) => row.system === secret)).toEqual([])
    const secretPath = `/api/identifiers?${new URLSearchParams({ system: secret, value: '234123412346' })}`
    const normalPath = `/api/identifiers?${new URLSearchParams({ system: normal, value: 'alpha-42' })}`
    const refused = await admin.fetch(secretPath)
    await expectStatus(refused, 417)
    expect(await refused.json()).toEqual({ error: {
      type: 'ValidationError',
      message: 'Searching this identifier needs fingerprinting, which is not switched on',
      fields: { code: 'fingerprint_unavailable' },
    } })
    expect(await snapshot()).toEqual(before)
    expect(await reader.get(normalPath)).toEqual({ people: [{
      person_id: person, resolved_to: person, replaced: false, current: true, assigner: '', pending_invite: false,
    }] })
    for (const path of [normalPath, secretPath]) {
      const response = await denied.fetch(path)
      await expectStatus(response, 403)
      expect(await response.json()).toEqual({ error: {
        type: 'PermissionError', message: 'You may not search people',
      } })
      expect(await snapshot()).toEqual(before)
    }
  })

  test('no Person read, no search; a Data Scope narrows the results', async ({ admin, createUser }) => {
    const p = await makePerson({ full_name: 'In scope', email: 'scoped.search@x.test' })
    const q = await makePerson({ full_name: 'Out of scope', email: 'other.search@x.test' })
    const none = await createUser({ email: 'no.person.read@x.test' })
    await expectRefused(none.get('/api/identifiers?system=email&value=scoped.search@x.test'), 403)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Person Searcher' } })
    await grantRole(admin, { table: 'Person', role: 'Person Searcher', can_read: true })
    const scoped = await createUser({ email: 'scoped.searcher@x.test', roles: ['Person Searcher'] })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: scoped.user, allow_table: 'Person', for_value: p } })
    expect((await scoped.get<{ people: { person_id: string }[] }>('/api/identifiers?system=email&value=scoped.search@x.test')).people.map((x) => x.person_id)).toEqual([p])
    expect((await scoped.get<{ people: unknown[] }>('/api/identifiers?system=email&value=other.search@x.test')).people).toEqual([])
    void q
  })

  // An invitee has no email identifier until their first Google sign-in, so
  // an email search also matches an open invite — still only for readers.
  test('an email search finds a pending Google invite, only for people who may read the invitee', async ({ admin, createUser }) => {
    const invitee = await makePerson({ full_name: 'Invited Ira' })
    await inviteGoogleRaw(invitee, 'Invited.Ira@x.test')
    const found = await admin.get<{ people: { person_id: string; pending_invite: boolean }[] }>('/api/identifiers?system=email&value=INVITED.IRA@x.test')
    expect(found.people.map((x) => [x.person_id, x.pending_invite])).toEqual([[invitee, true]])
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Person Searcher' } })
    await grantRole(admin, { table: 'Person', role: 'Person Searcher', can_read: true })
    const scoped = await createUser({ email: 'invite.scoped@x.test', roles: ['Person Searcher'] })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: scoped.user, allow_table: 'Person', for_value: scoped.user } })
    expect((await scoped.get<{ people: unknown[] }>('/api/identifiers?system=email&value=invited.ira@x.test')).people).toEqual([])
    // A person who holds the address and also has the invite is listed once.
    const both = await makePerson({ full_name: 'Both Bala', email: 'both.bala@x.test' })
    await inviteGoogleRaw(both, 'both.bala@x.test')
    expect((await admin.get<{ people: { person_id: string; pending_invite: boolean }[] }>('/api/identifiers?system=email&value=both.bala@x.test')).people.map((x) => [x.person_id, x.pending_invite])).toEqual([[both, false]])
    // A former holder re-invited at that address still shows the invite.
    const former = await makePerson({ full_name: 'Former Fathima' })
    await addIdentifier(former, { system: 'email', value: 'former.f@x.test', valid_from: '2024-01-01', valid_to: '2025-01-01' }, 'Administrator')
    await inviteGoogleRaw(former, 'former.f@x.test')
    expect((await admin.get<{ people: { person_id: string; current: boolean; pending_invite: boolean }[] }>('/api/identifiers?system=email&value=former.f@x.test')).people.map((x) => [x.person_id, x.current, x.pending_invite])).toEqual([[former, false, false], [former, true, true]])
  })
})

describe('built-in and replaced records', () => {
  test('independent identifier history blocks deleting a person without erasing mirrored email history', async ({ admin }) => {
    const person = await makePerson({ full_name: 'Keep this history', email: 'keep-history@x.test' })
    const { identifier } = await admin.post<{ identifier: { id: string } }>(`/api/people/${person}/identifiers`, {
      system: 'phone', value: '9847012345',
    })
    const before = await sql`select id, system, value, source from person_identifier where person_id = ${person} order by id`
    const response = await admin.fetch(`/api/table/Person/${person}`, { method: 'DELETE' })
    await expectStatus(response, 409)
    expect(await response.json()).toMatchObject({ error: { type: 'ConflictError', fields: { code: 'has_identifiers' } } })
    expect(await admin.get(`/api/table/Person/${person}`)).toMatchObject({ full_name: 'Keep this history', email: 'keep-history@x.test' })
    // on_trash deletes mirrors before checking independent history; its refusal
    // must roll that deletion back along with the refused Person deletion.
    expect(await sql`select id, system, value, source from person_identifier where person_id = ${person} order by id`).toEqual(before)
    expect(before).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: identifier.id, system: 'phone' }),
      expect.objectContaining({ system: 'email', source: 'person-email' }),
    ]))
  })

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

describe('the freeze: employee codes by hand until the roster sync runs (review B-M6)', () => {
  const STYLEHR_CODE = 'stylehr-employee-code'

  test('a joiner: a System Manager records the code with a note; it is unverified, and test mode signs them in by it', async ({ admin, api }) => {
    await applySeedPack('jeyarama')
    await sql`delete from person_identifier where system = ${STYLEHR_CODE} and source = 'stylehr-roster-sync'`
    const p = await makePerson({ full_name: 'New Joiner' })
    const addable = (await admin.get<{ addable: { row_id: string; note_required: boolean }[] }>(`/api/people/${p}/identifiers`)).addable
    expect(addable.find((s) => s.row_id === STYLEHR_CODE)).toEqual({ row_id: STYLEHR_CODE, label: 'StyleHR employee code', note_required: true })
    await expectRefused(admin.post(`/api/people/${p}/identifiers`, { system: STYLEHR_CODE, value: 'rr-20001' }), 417)
    const { identifier } = await admin.post<{ identifier: { verified: boolean; source: string; note: string; value: string } }>(
      `/api/people/${p}/identifiers`, { system: STYLEHR_CODE, value: 'rr-20001', note: 'Joiner 23-Oct, mailed by HR' })
    expect(identifier).toMatchObject({ value: 'RR-20001', verified: false, source: 'manual', note: 'Joiner 23-Oct, mailed by HR' })
    // The record number is not hand-editable, even now.
    await expectRefused(admin.post(`/api/people/${p}/identifiers`, { system: 'stylehr-employee-id', value: '90001', note: 'x' }), 403)

    const { configureDelegated } = await import('./identity-fixtures')
    await configureDelegated()
    await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by)
      values ('uid_joiner_20001', ${p}, 'stylehr', 'RR-20001', 'new.joiner', 'Administrator')`
    const { vi } = await import('vitest')
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    try {
      const res = await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'RR-20001', pwd: '', method: 'stylehr' }) })
      await expectStatus(res, 200)
      expect(((await res.json()) as { user: { row_id: string } }).user.row_id).toBe(p)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test('a correction: a carried-over code is ended with a note, never erased; a hand-recorded one may be removed', async ({ admin }) => {
    await applySeedPack('jeyarama')
    await sql`delete from person_identifier where system = ${STYLEHR_CODE} and source = 'stylehr-roster-sync'`
    const p = await makePerson({ full_name: 'Wrong Code' })
    const { identifier: carried } = await addIdentifier(p, { system: STYLEHR_CODE, value: 'RR-1' }, 'migration', { internal: { source: 'migration', verified: true } })
    const patch = (id: string, body: unknown) => admin.fetch(`/api/identifiers/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
    await expectStatus(await patch(carried.id, { end: true }), 417)
    await expectStatus(await patch(carried.id, { end: true, note: 'Wrong code; HR mail 23-Oct' }), 200)
    await expectStatus(await admin.fetch(`/api/identifiers/${carried.id}`, { method: 'DELETE' }), 403)
    const { identifier: typed } = await admin.post<{ identifier: { id: string } }>(`/api/people/${p}/identifiers`, { system: STYLEHR_CODE, value: 'RR-2', note: 'Right code' })
    await expectStatus(await admin.fetch(`/api/identifiers/${typed.id}`, { method: 'DELETE' }), 200)
  })

  test('once the roster sync has written a code, the hand path closes; a non-manager never had it', async ({ admin, createUser }) => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'After Sync' })
    const someoneElse = await makePerson({ full_name: 'Synced' })
    const clerk = await createUser({ email: 'clerk.codes@x.test' })
    await expectRefused(clerk.post(`/api/people/${clerk.user}/identifiers`, { system: STYLEHR_CODE, value: 'RR-3', note: 'mine' }), 403)
    await addIdentifier(someoneElse, { system: STYLEHR_CODE, value: 'RR-4' }, 'sync', ROSTER)
    await expectRefused(admin.post(`/api/people/${p}/identifiers`, { system: STYLEHR_CODE, value: 'RR-5', note: 'too late' }), 403)
  })
})

describe('changing a value needs a read of its person (review on #385)', () => {
  test('PATCH and DELETE follow the Person permission and Data Scope, as adding does', async ({ admin, createUser }) => {
    const { saveIdentifierSystem } = await import('../src/seed-packs')
    await saveIdentifierSystem({ row_id: 'badge', label: 'Badge', kind: 'contact', source: 'self', match: 'Off', sensitivity: 'Normal', edited_by: 'reviewers' })
    const inScope = await makePerson({ full_name: 'Badge In' })
    const outOfScope = await makePerson({ full_name: 'Badge Out' })
    const a = await addIdentifier(inScope, { system: 'badge', value: 'b-1' }, 'Administrator')
    const b = await addIdentifier(outOfScope, { system: 'badge', value: 'b-2' }, 'Administrator')
    await grantRole(admin, { table: 'Person', role: 'Data Quality Manager', can_read: true })
    const reviewer = await createUser({ email: 'scoped.reviewer@x.test', roles: ['Data Quality Manager'] })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: reviewer.user, allow_table: 'Person', for_value: inScope } })
    const patch = (id: string) => reviewer.fetch(`/api/identifiers/${id}`, { method: 'PATCH', body: JSON.stringify({ note: 'checked' }) })
    await expectStatus(await patch(a.identifier.id), 200)
    expect([403, 404]).toContain((await patch(b.identifier.id)).status)
    expect([403, 404]).toContain((await reviewer.fetch(`/api/identifiers/${b.identifier.id}`, { method: 'DELETE' })).status)
    expect(await sql`select note from person_identifier where id = ${b.identifier.id}`).toEqual([{ note: null }])
  })
})

describe('the Person picker finds people by their current employee code (review B-M3)', () => {
  test('by a current code row, with the code as the label’s detail; an ended code or a replaced record is not offered', async ({ admin }) => {
    await applySeedPack('jeyarama')
    const coded = await makePerson({ full_name: 'Coded Kala' })
    await addIdentifier(coded, { system: 'stylehr-employee-code', value: 'RR-41001' }, 'sync', ROSTER)
    const ended = await makePerson({ full_name: 'Ended Eswar' })
    await addIdentifier(ended, { system: 'stylehr-employee-code', value: 'RR-41002', valid_from: '2024-01-01', valid_to: '2025-01-01' }, 'sync', ROSTER)
    const survivor = await makePerson({ full_name: 'Kept Kavya' })
    const merged = await makePerson({ full_name: 'Merged Mani' })
    await addIdentifier(merged, { system: 'stylehr-employee-code', value: 'RR-41003' }, 'sync', ROSTER)
    await sql`update person set enabled = false, replaced_by = ${survivor} where row_id = ${merged}`
    const pick = async (q: string) => (await admin.get<{ people: { row_id: string; label: string }[] }>(`/api/people/pick?q=${q}`)).people
    expect(await pick('rr-41001')).toEqual([{ row_id: coded, label: 'Coded Kala · RR-41001' }])
    expect(await pick('RR-41002')).toEqual([])
    expect(await pick('RR-41003')).toEqual([])
  })
})

describe('who may change a value follows its system (D9)', () => {
  test('self editing does not let a Person reader change someone else’s phone', async ({ admin, createUser }) => {
    const owner = await createUser({ email: 'phone.owner@x.test' })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Phone Reader' } })
    await grantRole(admin, { table: 'Person', role: 'Phone Reader', can_read: true })
    const reader = await createUser({ email: 'phone.other@x.test', roles: ['Phone Reader'] })
    const { identifier } = await owner.post<{ identifier: { id: string; source: string; verified: boolean } }>(`/api/people/${owner.user}/identifiers`, {
      system: 'phone', value: '9847012345',
    })
    expect(identifier).toMatchObject({ source: 'self', verified: false })
    // Confirm the negative writes reach the system's editor rule, not a missing Person read.
    expect(await reader.get(`/api/table/Person/${owner.user}`)).toMatchObject({ row_id: owner.user })
    const before = await sql`select * from person_identifier where person_id = ${owner.user} order by id`
    const denied = {
      status: 403, type: 'PermissionError', message: expect.stringContaining('You may not change'), fields: { code: 'not_allowed' },
    }
    await expectApiError(reader.post(`/api/people/${owner.user}/identifiers`, { system: 'phone', value: '9847099999' }), denied)
    expect(await sql`select * from person_identifier where person_id = ${owner.user} order by id`).toEqual(before)
    await expectApiError(reader.fetch(`/api/identifiers/${identifier.id}`, { method: 'PATCH', body: JSON.stringify({ note: 'not mine' }) }), denied)
    expect(await sql`select * from person_identifier where person_id = ${owner.user} order by id`).toEqual(before)
    await expectApiError(reader.fetch(`/api/identifiers/${identifier.id}`, { method: 'DELETE' }), denied)
    expect(await sql`select * from person_identifier where person_id = ${owner.user} order by id`).toEqual(before)
  })

  test('a person without System Manager cannot add their own value to a system edited by System Managers, or by reviewers', async ({ createUser }) => {
    await saveIdentifierSystem({ row_id: 'badge-sm', label: 'Locker', kind: 'contact', source: 'self', match: 'Off', sensitivity: 'Normal', edited_by: 'system-manager' })
    await saveIdentifierSystem({ row_id: 'badge-rv', label: 'Uniform', kind: 'contact', source: 'self', match: 'Off', sensitivity: 'Normal', edited_by: 'reviewers' })
    const clerk = await createUser({ email: 'clerk.badges@x.test' })
    await expectApiError(clerk.post(`/api/people/${clerk.user}/identifiers`, { system: 'badge-sm', value: 'L-1' }), {
      status: 403, type: 'PermissionError', message: expect.stringContaining('You may not change Locker values'), fields: { code: 'not_allowed' },
    })
    await expectApiError(clerk.post(`/api/people/${clerk.user}/identifiers`, { system: 'badge-rv', value: 'U-1' }), {
      status: 403, type: 'PermissionError', message: expect.stringContaining('You may not change Uniform values'), fields: { code: 'not_allowed' },
    })
    expect(await sql`select 1 from person_identifier where person_id = ${clerk.user} and system in ('badge-sm', 'badge-rv')`).toEqual([])
  })
})

describe('missing records and single current values', () => {
  test('unknown systems, people and identifiers report not found and leave existing data alone', async ({ admin }) => {
    const p = await makePerson({ full_name: 'Unaffected holder' })
    await addIdentifier(p, { system: 'phone', value: '9847012345' }, 'Administrator')
    const before = await sql`select * from person_identifier order by id`
    await expectApiError(admin.post(`/api/people/${p}/identifiers`, { system: 'no-such-system', value: 'x' }), {
      status: 404, type: 'NotFoundError', message: expect.stringContaining('Identifier system no-such-system not found'),
    })
    expect(await sql`select * from person_identifier order by id`).toEqual(before)
    // Direct public APIs also defend callers that do not come through a route's Person read.
    await expect(addIdentifier('no-such-person', { system: 'phone', value: '9847099999' }, 'Administrator'))
      .rejects.toMatchObject({ type: 'NotFoundError', message: 'Person no-such-person not found' })
    expect(await sql`select * from person_identifier order by id`).toEqual(before)
    await expect(updateIdentifier('pid_missing', { note: 'missing' }, 'Administrator'))
      .rejects.toMatchObject({ type: 'NotFoundError', message: 'Identifier pid_missing not found' })
    expect(await sql`select * from person_identifier order by id`).toEqual(before)
    await expect(deleteIdentifier('pid_missing', 'Administrator'))
      .rejects.toMatchObject({ type: 'NotFoundError', message: 'Identifier pid_missing not found' })
    expect(await sql`select * from person_identifier order by id`).toEqual(before)
    await expectApiError(admin.fetch('/api/identifiers/pid_missing', { method: 'PATCH', body: JSON.stringify({ note: 'missing' }) }), {
      status: 404, type: 'NotFoundError', message: expect.stringContaining('Identifier pid_missing not found'),
    })
    expect(await sql`select * from person_identifier order by id`).toEqual(before)
  })

  test('a single-value system refuses a second current value but keeps the first as history when ended', async ({ admin }) => {
    await saveIdentifierSystem({ row_id: 'single-badge', label: 'Single badge', kind: 'contact', match: 'Off', one_per_person: true, edited_by: 'system-manager' })
    const p = await makePerson({ full_name: 'Single badge holder' })
    const { identifier } = await admin.post<{ identifier: { id: string } }>(`/api/people/${p}/identifiers`, {
      system: 'single-badge', value: 'first', valid_from: '2024-01-01',
    })
    const before = await sql`select * from person_identifier where person_id = ${p} order by id`
    await expectApiError(admin.post(`/api/people/${p}/identifiers`, { system: 'single-badge', value: 'second' }), {
      status: 409, type: 'ConflictError', message: expect.stringContaining('This person already has a current value in this system'), fields: { code: 'one_per_person' },
    })
    expect(await sql`select * from person_identifier where person_id = ${p} order by id`).toEqual(before)
    const ended = await admin.fetch(`/api/identifiers/${identifier.id}`, { method: 'PATCH', body: JSON.stringify({ valid_to: '2025-01-01' }) })
    await expectStatus(ended, 200)
    await admin.post(`/api/people/${p}/identifiers`, { system: 'single-badge', value: 'second', valid_from: '2025-01-01' })
    expect(await sql`select value, lower(valid)::text as valid_from, upper(valid)::text as valid_to
      from person_identifier where person_id = ${p} and system = 'single-badge' order by value`)
      .toEqual([{ value: 'first', valid_from: '2024-01-01', valid_to: '2025-01-01' }, { value: 'second', valid_from: '2025-01-01', valid_to: null }])
  })
})

describe('write-through skips a provider value that does not fit its system', () => {
  test('a link whose subject the method’s system cannot read writes no row, and unlinking it still ends it', async ({ admin }) => {
    await configureDelegated()
    // An administrator pointed StyleHR at the phone system by mistake.
    await sql`update sign_in_method set identifier_system = 'phone' where row_id = 'stylehr'`
    const p = await makePerson({ full_name: 'Misfit Link' })
    const { id } = await admin.post<{ id: string }>(`/api/people/${p}/identities`, { method: 'stylehr', subject: '900001', sign_in_name: 'misfit' })
    expect(await sql`select 1 from person_identifier where person_id = ${p} and system = 'phone'`).toEqual([])
    await expectStatus(await admin.fetch(`/api/identities/${id}`, { method: 'DELETE' }), 200)
    expect(await sql`select ended_reason from sign_in_identity where id = ${id}`).toEqual([{ ended_reason: 'unlinked' }])
  })
})

describe('who may write a source-fed value', () => {
  const sourceSystem = (row_id: string, source: string | null) =>
    saveIdentifierSystem({ row_id, label: row_id, kind: 'contact', sensitivity: 'Normal', match: 'Off', enabled: true, edited_by: 'source', source })

  test('the Identity Sync role writes it, verified', async ({ createUser }) => {
    await sourceSystem('probe-synced', 'probe-roster')
    const sync = await createUser({ roles: ['Identity Sync'] })
    const p = await makePerson({})
    await addIdentifier(p, { system: 'probe-synced', value: 'S-1' }, sync.user!)
    expect(await sql`select verified from person_identifier where person_id = ${p} and system = 'probe-synced'`).toEqual([{ verified: true }])
  })

  test('with no source named, a System Manager may not write it by hand', async () => {
    await sourceSystem('probe-sourceless', null)
    const p = await makePerson({})
    await expect(addIdentifier(p, { system: 'probe-sourceless', value: 'S-1' }, 'Administrator')).rejects.toMatchObject({ type: 'PermissionError' })
  })

  test('a Secret system is never offered in the add form', async () => {
    await sql`insert into identifier_system (row_id, label, kind, sensitivity, match, enabled, edited_by)
      values ('probe-secret', 'Probe secret', 'national-id', 'Secret', 'Off', true, 'system-manager')`
    const p = await makePerson({})
    expect((await addableSystems(p, 'Administrator')).map((s) => s.row_id)).not.toContain('probe-secret')
  })
})

describe('the identifiers a sign-in mirrors', () => {
  test('a sign-in whose identifier system is turned off mirrors nothing, and ends cleanly once that system is gone', async () => {
    await configureDelegated()
    await sql`insert into identifier_system (row_id, label, kind, sensitivity, match, enabled) values ('probe-off', 'Probe off', 'external-record', 'Normal', 'Off', false)`
    await sql`update sign_in_method set identifier_system = 'probe-off' where row_id = 'stylehr'`
    const p = await makePerson({})
    const id = await linkDelegated(p, 'probe_off_user', { subject: 'OFF-1' })
    await writeThroughIdentity(id)
    expect(await sql`select 1 from person_identifier where system = 'probe-off'`).toHaveLength(0)
    await sql`delete from identifier_system where row_id = 'probe-off'`
    await expect(endIdentityIdentifiers(id)).resolves.toBeUndefined()
  })

  test('a sign-in of a person merged into another mirrors nothing', async () => {
    await configureDelegated()
    await applySeedPack('jeyarama')
    const survivor = await makePerson({})
    const merged = await makePerson({})
    const id = await linkDelegated(merged, 'merged_user', { subject: 'M-1' })
    await sql`update person set enabled = false, replaced_by = ${survivor} where row_id = ${merged}`
    await writeThroughIdentity(id)
    expect(await sql`select 1 from person_identifier where person_id = ${merged} and source = 'sign-in'`).toHaveLength(0)
  })

  test('ending a Google link keeps the address the person still holds as their own', async () => {
    const p = await makePerson({ email: 'kept.address@gmail.com' })
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by) values ('uid_keep', ${p}, 'google', 'g-keep', 'kept.address@gmail.com', 'test')`
    await writeThroughIdentity('uid_keep')
    await endIdentityIdentifiers('uid_keep')
    expect(await sql`select 1 from person_identifier where person_id = ${p} and system = 'email' and value = 'kept.address@gmail.com' and upper_inf(valid)`).not.toHaveLength(0)
  })

  test('a Google address reported unchanged moves nothing', async () => {
    const p = await makePerson({})
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by) values ('uid_same', ${p}, 'google', 'g-same', 'same@gmail.com', 'test')`
    await writeThroughIdentity('uid_same')
    const before = await sql`select * from person_identifier where person_id = ${p} order by id`
    await reconcileIdentityEmail('uid_same', 'Same@Gmail.com')
    expect(await sql`select * from person_identifier where person_id = ${p} order by id`).toEqual(before)
  })
})
