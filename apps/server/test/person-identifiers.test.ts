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
import { inviteGoogleRaw } from './identity-fixtures'

const ROSTER = { internal: { source: 'stylehr-roster-sync', verified: true } }

describe('normalising', () => {
  test('codes are upper-cased, addresses lower-cased, Indian mobiles canonical; national IDs need a valid check digit', () => {
    expect(normaliseValue(' rr-0102 ', 'upper')).toBe('RR-0102')
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
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/comes from stylehr-roster-sync; correct it there/)
    await expect(admin.post(`/api/people/${p}/identifiers`, { system: 'stylehr-employee-code', value: 'RR-10' })).rejects.toMatchObject({ status: 403 })
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
  test('restricted values are shown only to restricted readers; hidden ones never in a panel, but found by exact value', async ({ admin, createUser }) => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'Shown', email: 'shown@x.test' })
    await addIdentifier(p, { system: 'phone', value: '9847012345' }, 'Administrator')
    await addIdentifier(p, { system: 'stylehr-employee-id', value: '900001' }, 'sync', ROSTER)
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
    expect((await admin.get<{ people: { person_id: string }[] }>('/api/identifiers?system=stylehr-employee-id&value=900001')).people.map((x) => x.person_id)).toEqual([p])
    await expect(reader.get('/api/identifiers?system=stylehr-employee-id&value=900001')).rejects.toMatchObject({ status: 403 })
    expect((await reader.get<{ people: { person_id: string }[] }>('/api/identifiers?system=email&value=SHOWN@x.test')).people.map((x) => x.person_id)).toEqual([p])
  })
})

describe('search respects who may read people (Codex review on #385)', () => {
  test('no Person read, no search; a Data Scope narrows the results', async ({ admin, createUser }) => {
    const p = await makePerson({ full_name: 'In scope', email: 'scoped.search@x.test' })
    const q = await makePerson({ full_name: 'Out of scope', email: 'other.search@x.test' })
    const none = await createUser({ email: 'no.person.read@x.test' })
    await expect(none.get('/api/identifiers?system=email&value=scoped.search@x.test')).rejects.toMatchObject({ status: 403 })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Person Searcher' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: 'Person Searcher', can_read: true } })
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
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: 'Person Searcher', can_read: true } })
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
    await expect(admin.post(`/api/people/${p}/identifiers`, { system: STYLEHR_CODE, value: 'rr-20001' })).rejects.toMatchObject({ status: 417 })
    const { identifier } = await admin.post<{ identifier: { verified: boolean; source: string; note: string; value: string } }>(
      `/api/people/${p}/identifiers`, { system: STYLEHR_CODE, value: 'rr-20001', note: 'Joiner 23-Oct, mailed by HR' })
    expect(identifier).toMatchObject({ value: 'RR-20001', verified: false, source: 'manual', note: 'Joiner 23-Oct, mailed by HR' })
    // The record number is not hand-editable, even now.
    await expect(admin.post(`/api/people/${p}/identifiers`, { system: 'stylehr-employee-id', value: '90001', note: 'x' })).rejects.toMatchObject({ status: 403 })

    const { configureDelegated } = await import('./identity-fixtures')
    await configureDelegated()
    await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, subject_kind, linked_by)
      values ('uid_joiner_20001', ${p}, 'stylehr', 'RR-20001', 'new.joiner', 'employee-code', 'Administrator')`
    const { vi } = await import('vitest')
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    try {
      const res = await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'RR-20001', pwd: '', method: 'stylehr' }) })
      expect(res.status).toBe(200)
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
    expect((await patch(carried.id, { end: true })).status).toBe(417)
    expect((await patch(carried.id, { end: true, note: 'Wrong code; HR mail 23-Oct' })).status).toBe(200)
    expect((await admin.fetch(`/api/identifiers/${carried.id}`, { method: 'DELETE' })).status).toBe(403)
    const { identifier: typed } = await admin.post<{ identifier: { id: string } }>(`/api/people/${p}/identifiers`, { system: STYLEHR_CODE, value: 'RR-2', note: 'Right code' })
    expect((await admin.fetch(`/api/identifiers/${typed.id}`, { method: 'DELETE' })).status).toBe(200)
  })

  test('once the roster sync has written a code, the hand path closes; a non-manager never had it', async ({ admin, createUser }) => {
    await applySeedPack('jeyarama')
    const p = await makePerson({ full_name: 'After Sync' })
    const someoneElse = await makePerson({ full_name: 'Synced' })
    const clerk = await createUser({ email: 'clerk.codes@x.test' })
    await expect(clerk.post(`/api/people/${clerk.user}/identifiers`, { system: STYLEHR_CODE, value: 'RR-3', note: 'mine' })).rejects.toMatchObject({ status: 403 })
    await addIdentifier(someoneElse, { system: STYLEHR_CODE, value: 'RR-4' }, 'sync', ROSTER)
    await expect(admin.post(`/api/people/${p}/identifiers`, { system: STYLEHR_CODE, value: 'RR-5', note: 'too late' })).rejects.toMatchObject({ status: 403 })
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
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: 'Data Quality Manager', can_read: true } })
    const reviewer = await createUser({ email: 'scoped.reviewer@x.test', roles: ['Data Quality Manager'] })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: reviewer.user, allow_table: 'Person', for_value: inScope } })
    const patch = (id: string) => reviewer.fetch(`/api/identifiers/${id}`, { method: 'PATCH', body: JSON.stringify({ note: 'checked' }) })
    expect((await patch(a.identifier.id)).status).toBe(200)
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
