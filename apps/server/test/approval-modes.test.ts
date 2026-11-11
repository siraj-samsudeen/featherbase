import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'
import { tableRelation } from '../src/table-engine'
import { expectRefused } from './fixtures'
import { applyInstanceSettings, type InstanceSettingsFile } from '../src/instance-settings'

// #1191: how each kind of approval works. "Approve first" changes nothing until an approver
// approves; "Apply now, review after" changes the row at once, and a reviewer confirms or undoes
// it. Through the proof app, which hands each helper call straight through. Everything is made up.
const directory = resolve('../..', 'test-apps/proposal-proof')
const pinned = (client: TestClient) => makeClient({ request: (path, init) => client.fetch(String(path), {
  ...init, headers: { ...init?.headers, 'X-Featherbase-App-Version': 'proposalproof@1.0.0' },
}) }, client.token, client.user)
const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
const probe = async (client: TestClient, payload: object) =>
  (await client.post<any>('/api/app_actions/proposalproof/probe', { idempotencyKey: randomUUID(), payload })).result

const APPLY_NOW = 'Apply now, review after'
const APPROVE_FIRST = 'Approve first'

async function setUp(admin: TestClient, createUser: CreateUserFn) {
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'proposalproof' })
  await admin.post('/api/table_def', { name: 'Placement', id_pattern: 'field:placement_id', track_changes: true, columns: [
    { column_name: 'placement_id', column_type: 'Data', reqd: true },
    { column_name: 'label', column_type: 'Data' }, { column_name: 'site', column_type: 'Data' },
    { column_name: 'starts_on', column_type: 'Date' }, { column_name: 'ends_on', column_type: 'Date' },
    { column_name: 'source', column_type: 'Data' },
  ] })
  await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'proposalproof.linked_tables', value: JSON.stringify(['Placement']) } })
  await admin.post('/api/save_row', { table: 'Placement', row: { placement_id: 'P-1', label: 'Sarees', site: 'North', starts_on: '2026-10-01' } })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Proof Editor' } })
  const maker = await createUser({ email: `maker-${randomUUID()}@example.test` })
  const manager = await createUser({ email: `manager-${randomUUID()}@example.test` })
  const other = await createUser({ email: `other-${randomUUID()}@example.test` })
  await sql`update person set password_hash = 'made-up' where row_id in ${sql([maker.user!, manager.user!, other.user!])}`
  return { maker, manager, other }
}

const setMode = (admin: TestClient, type: string, mode: string) =>
  admin.post<any>('/api/save_row', { table: 'Approval Type', row: { row_id: `proposalproof.${type}`, mode } })
const approvers = (manager: string | null) => ({ people: manager ? [manager] : [], fallbackRoles: ['Proof Editor'] })
const apply = (stamp = 'P-2') => ({ effectiveOn: '2026-11-05', newRow: { placement_id: stamp, source: 'Proof' } })
const ask = (manager: string | null, more: object = {}) => ({
  op: 'propose', request: { table: 'Placement', row: 'P-1', changes: { label: 'Silk' }, approvers: approvers(manager), about: { kind: 'move' },
    type: 'label_change', apply: apply(), ...more },
})
const placement = async (id: string) => (await sql`select * from ${sql(await tableRelation('Placement'))} where row_id = ${id}`)[0]
const asDay = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : value)
const count = async () => (await sql`select count(*)::int as n from ${sql(await tableRelation('Placement'))}`)[0].n as number

describe('the setting: one Approval Type row per declared type', () => {
  test('with no row a type is approve first, and nothing changes until it is approved', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    expect(proposal).toMatchObject({ state: 'Pending', approval_type: 'label_change', approval_mode: APPROVE_FIRST })
    expect(await placement('P-1')).toMatchObject({ label: 'Sarees', ends_on: null })
    expect(await count()).toBe(1)
  })

  test('a proposal naming no type is approve first, as before', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await setMode(admin, 'label_change', APPLY_NOW)
    const { type: _type, apply: _apply, ...plain } = ask(manager.user).request
    expect(await probe(maker, { op: 'propose', request: plain })).toMatchObject({ state: 'Pending', approval_type: null, approval_mode: APPROVE_FIRST })
  })

  test('only a type the app declares can be named or set, and the row is named <app>.<type>', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await expectRefused(probe(maker, ask(manager.user, { type: 'not_declared' })), 417)
    await expectRefused(setMode(admin, 'not_declared', APPLY_NOW), 417)
    await expectRefused(admin.post('/api/save_row', { table: 'Approval Type', row: { row_id: 'nonsense', mode: APPLY_NOW } }), 417)
    await expectRefused(admin.post('/api/save_row', { table: 'Approval Type', row: { row_id: 'noapp.label_change', mode: APPLY_NOW } }), 417)
    // The app's declaration fills the rest; the mode is the one thing an administrator sets.
    expect(await setMode(admin, 'label_change', APPLY_NOW)).toMatchObject({ app: 'proposalproof', approval_type: 'label_change', title: 'Change a label', grants_access: false, mode: APPLY_NOW })
    await expectRefused(setMode(admin, 'label_change', 'Whenever'), 417)
  })

  test('a type that grants access is approve first, always', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await expectRefused(setMode(admin, 'role_grant', APPLY_NOW), 417)
    expect(await setMode(admin, 'role_grant', APPROVE_FIRST)).toMatchObject({ grants_access: true, mode: APPROVE_FIRST })
    // Even a value forced past the form is not followed.
    await sql`update approval_type set mode = ${APPLY_NOW} where row_id = 'proposalproof.role_grant'`
    const proposal = await probe(maker, ask(manager.user, { type: 'role_grant' }))
    expect(proposal).toMatchObject({ state: 'Pending', approval_mode: APPROVE_FIRST })
    expect(await placement('P-1')).toMatchObject({ label: 'Sarees', ends_on: null })
  })

  test('an instance settings file sets a mode, and is refused one that would grant access at once', async ({ admin, createUser }) => {
    await setUp(admin, createUser)
    const file = (type: string) => ({ settings: { 'Approval Type': [{ row_id: `proposalproof.${type}`, mode: APPLY_NOW }] } } as unknown as InstanceSettingsFile)
    await applyInstanceSettings(file('label_change'), { by: 'Administrator' })
    expect(await sql`select mode, grants_access from approval_type where row_id = 'proposalproof.label_change'`).toEqual([{ mode: APPLY_NOW, grants_access: false }])
    await expect(applyInstanceSettings(file('role_grant'), { by: 'Administrator' })).rejects.toThrow('always approved first')
  })

  test('a read can ask how a type works, to say so before anyone asks', async ({ admin, createUser }) => {
    const { maker } = await setUp(admin, createUser)
    const modeOf = async (type: string) => (await maker.post<any>('/api/app_reads/proposalproof/look', { payload: { modeOf: type } })).result
    expect(await modeOf('label_change')).toBe(APPROVE_FIRST)
    await setMode(admin, 'label_change', APPLY_NOW)
    expect(await modeOf('label_change')).toBe(APPLY_NOW)
    await sql`insert into approval_type (row_id, mode) values ('proposalproof.role_grant', ${APPLY_NOW})`
    expect(await modeOf('role_grant')).toBe(APPROVE_FIRST)
    await expectRefused(maker.post('/api/app_reads/proposalproof/look', { payload: { modeOf: 'not_declared' } }), 417)
  })

  test('only a System Manager changes it', async ({ admin, createUser }) => {
    const { maker } = await setUp(admin, createUser)
    await expectRefused(maker.post('/api/save_row', { table: 'Approval Type', row: { row_id: 'proposalproof.label_change', mode: APPLY_NOW } }), 403)
  })
})

describe('apply now: the change is made when it is asked for', () => {
  test('a changed row: the old one ends, the new one starts, and it waits for review', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await setMode(admin, 'label_change', APPLY_NOW)
    const proposal = await probe(maker, ask(manager.user))
    expect(proposal).toMatchObject({ state: 'Not yet reviewed', approval_mode: APPLY_NOW, result_row: 'P-2', decided_by: null,
      route: { people: [manager.user], roles: [] } })
    expect(asDay((await placement('P-1')).ends_on)).toBe('2026-11-04')
    const added = await placement('P-2')
    expect(added).toMatchObject({ label: 'Silk', site: 'North', source: 'Proof', ends_on: null, created_by: maker.user })
    expect(asDay(added.starts_on)).toBe('2026-11-05')
    const events = await sql`select data from version where ref_table = 'Placement' and ref_name = 'P-2'`
    expect(events.map(e => e.data)).toContainEqual(expect.objectContaining({ change_proposal: proposal.row_id, made_by: maker.user, approved_by: null }))
  })

  test('a new row, and an ending, apply the same way', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await setMode(admin, 'label_change', APPLY_NOW)
    const added = await probe(maker, ask(manager.user, { row: null, changes: { label: 'Linen', site: 'North' }, apply: apply('P-3') }))
    expect(added).toMatchObject({ state: 'Not yet reviewed', result_row: 'P-3' })
    expect(await placement('P-3')).toMatchObject({ label: 'Linen' })
    const ended = await probe(maker, ask(manager.user, { changes: {}, ends: true, apply: { effectiveOn: '2026-11-05' } }))
    expect(ended).toMatchObject({ state: 'Not yet reviewed', result_row: null, ends_row: true })
    expect(asDay((await placement('P-1')).ends_on)).toBe('2026-11-04')
  })

  test('it needs the day and the new row\'s stamp, and refuses with nothing written', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await setMode(admin, 'label_change', APPLY_NOW)
    await expectRefused(probe(maker, ask(manager.user, { apply: undefined })), 417)
    await expectRefused(probe(maker, ask(manager.user, { apply: { effectiveOn: 'soon' } })), 417)
    await expectRefused(probe(maker, ask(manager.user, { apply: { effectiveOn: '2026-11-05', newRow: { label: 'x' } } })), 417)
    expect((await sql`select count(*)::int as n from change_proposal`)[0].n).toBe(0)
    expect(await placement('P-1')).toMatchObject({ ends_on: null })
  })

  test('a row that does not fit the day it would apply on is refused, saying why, with nothing written', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await admin.post('/api/save_row', { table: 'Placement', row: { placement_id: 'P-LATER', label: 'Cotton', starts_on: '2026-12-01' } })
    await setMode(admin, 'label_change', APPLY_NOW)
    await expect(probe(maker, ask(manager.user, { row: 'P-LATER' }))).rejects.toMatchObject({ status: 417, message: expect.stringContaining('It changed after this was asked for') })
    expect((await sql`select count(*)::int as n from change_proposal`)[0].n).toBe(0)
    expect(await placement('P-2')).toBeUndefined()
  })

  test('nobody else to review it: refused, as an approval would be', async ({ admin, createUser }) => {
    const { maker } = await setUp(admin, createUser)
    await setMode(admin, 'label_change', APPLY_NOW)
    await expectRefused(probe(maker, ask(null)), 417)
    expect(await count()).toBe(1)
  })

  test('other proposals waiting on the same row go back for a fresh review', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    const waiting = await probe(other, ask(manager.user, { changes: { label: 'Wool' } }))
    await setMode(admin, 'label_change', APPLY_NOW)
    await probe(maker, ask(manager.user))
    const [after] = await probe(manager, { op: 'proposals', filter: { ids: [waiting.row_id] } })
    expect(after).toMatchObject({ state: 'Needs fresh review', approval_mode: APPROVE_FIRST })
  })

  test('a proposal keeps the mode it was made under', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const waiting = await probe(maker, ask(manager.user))
    await setMode(admin, 'label_change', APPLY_NOW)
    expect((await probe(manager, { op: 'approve', id: waiting.row_id, decision: { approvers: approvers(manager.user), ...apply('P-9') } })).state).toBe('Applied')
  })
})

describe('confirm', () => {
  test('a reviewer on the route confirms; never the maker, nobody else, and only once', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    await setMode(admin, 'label_change', APPLY_NOW)
    const proposal = await probe(maker, ask(manager.user))
    const decision = { approvers: approvers(manager.user) }
    await expectRefused(probe(maker, { op: 'confirm', id: proposal.row_id, decision }), 417)
    await expectRefused(probe(other, { op: 'confirm', id: proposal.row_id, decision }), 417)
    const confirmed = await probe(manager, { op: 'confirm', id: proposal.row_id, decision: { ...decision, note: '  Right call  ' } })
    expect(confirmed).toMatchObject({ state: 'Confirmed', decided_by: manager.user, decision_reason: 'Right call' })
    expect(confirmed.decided_at).toBeTruthy()
    await expectRefused(probe(manager, { op: 'confirm', id: proposal.row_id, decision }), 417)
    await expectRefused(probe(manager, { op: 'undo', id: proposal.row_id, decision: { ...decision, reason: 'Late' } }), 417)
    expect(await placement('P-2')).toMatchObject({ label: 'Silk', retired_at: null })
  })

  test('confirm and undo refuse a proposal still waiting; approving and the rest refuse an applied one', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const decision = { approvers: approvers(manager.user) }
    const waiting = await probe(maker, ask(manager.user))
    await expectRefused(probe(manager, { op: 'confirm', id: waiting.row_id, decision }), 417)
    await expectRefused(probe(manager, { op: 'undo', id: waiting.row_id, decision: { ...decision, reason: 'No' } }), 417)
    await setMode(admin, 'label_change', APPLY_NOW)
    const applied = await probe(maker, ask(manager.user, { row: null, changes: { label: 'Linen' }, apply: apply('P-5') }))
    await expectRefused(probe(manager, { op: 'approve', id: applied.row_id, decision: { ...decision, ...apply('P-6') } }), 417)
    await expectRefused(probe(manager, { op: 'reject', id: applied.row_id, decision: { ...decision, reason: 'No' } }), 417)
    await expectRefused(probe(manager, { op: 'needs_fresh_review', id: applied.row_id, decision: { ...decision, reason: 'No' } }), 417)
    await expectRefused(probe(maker, { op: 'withdraw', id: applied.row_id }), 417)
  })
})

describe('undo puts the rows back as they were', () => {
  test('a reviewer undoes with a reason: the added row is retired, the old one runs on, and the record stays', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    await setMode(admin, 'label_change', APPLY_NOW)
    const proposal = await probe(maker, ask(manager.user))
    const decision = { approvers: approvers(manager.user) }
    await expectRefused(probe(manager, { op: 'undo', id: proposal.row_id, decision: { ...decision, reason: '  ' } }), 417)
    await expectRefused(probe(other, { op: 'undo', id: proposal.row_id, decision: { ...decision, reason: 'Wrong' } }), 417)
    const undone = await probe(manager, { op: 'undo', id: proposal.row_id, decision: { ...decision, reason: 'It belongs with Silk' } })
    expect(undone).toMatchObject({ state: 'Undone', decided_by: manager.user, decision_reason: 'It belongs with Silk', result_row: 'P-2', maker: maker.user })
    expect(await placement('P-1')).toMatchObject({ label: 'Sarees', ends_on: null })
    const retired = await placement('P-2')
    expect(retired.retired_at).not.toBeNull()
    // Never in force either: whatever reads by date, such as who may see what, drops it too.
    expect(asDay(retired.ends_on)).toBe('2026-11-04')
    expect(retired).toMatchObject({ retired_by: manager.user, retired_reason: 'Undone: It belongs with Silk' })
    // Out of every read: the app sees only the row as it was.
    expect(await probe(maker, { op: 'list', table: 'Placement', args: { fields: ['label', 'ends_on'] } })).toEqual([{ label: 'Sarees', ends_on: null }])
    // Unless the app asks for retired rows, to find the identifiers they still hold.
    expect(await probe(maker, { op: 'list', table: 'Placement', args: { fields: ['row_id'], filters: [['retired_at', '!=', null]] } })).toEqual([{ row_id: 'P-2' }])
    const events = (await sql`select data from version where ref_table = 'Placement' and ref_name = 'P-1'`).map(e => e.data)
    expect(events).toContainEqual(expect.objectContaining({ change_proposal: proposal.row_id, undone_by: manager.user }))
  })

  test('the maker undoes their own, with no reason needed', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await setMode(admin, 'label_change', APPLY_NOW)
    const proposal = await probe(maker, ask(manager.user))
    expect(await probe(maker, { op: 'undo', id: proposal.row_id, decision: { approvers: approvers(manager.user) } }))
      .toMatchObject({ state: 'Undone', decided_by: maker.user, decision_reason: null })
    expect(await placement('P-1')).toMatchObject({ ends_on: null })
  })

  test('an ending is undone by putting its end date back; a new row by retiring it', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await admin.post('/api/save_row', { table: 'Placement', row: { placement_id: 'P-END', label: 'Cotton', starts_on: '2026-10-01', ends_on: '2027-03-31' } })
    await setMode(admin, 'label_change', APPLY_NOW)
    const ending = await probe(maker, ask(manager.user, { changes: {}, ends: true, apply: { effectiveOn: '2026-11-05' } }))
    // A row with a planned end gets that end back, not none.
    const planned = await probe(maker, ask(manager.user, { row: 'P-END', apply: apply('P-REPLACED') }))
    const added = await probe(maker, ask(manager.user, { row: null, changes: { label: 'Linen' }, apply: apply('P-NEW') }))
    const decision = { approvers: approvers(manager.user), reason: 'Not needed' }
    await probe(manager, { op: 'undo', id: ending.row_id, decision })
    expect((await placement('P-1')).ends_on).toBeNull()
    await probe(manager, { op: 'undo', id: planned.row_id, decision })
    expect(asDay((await placement('P-END')).ends_on)).toBe('2027-03-31')
    await probe(manager, { op: 'undo', id: added.row_id, decision })
    expect((await placement('P-NEW')).retired_at).not.toBeNull()
    expect(asDay((await placement('P-NEW')).ends_on)).toBe('2026-11-04')
  })

  test('refused, with nothing changed, when either row has changed since', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await setMode(admin, 'label_change', APPLY_NOW)
    const decision = { approvers: approvers(manager.user), reason: 'Wrong' }
    const first = await probe(maker, ask(manager.user))
    const added = await placement('P-2')
    await admin.post('/api/save_row', { table: 'Placement', row: { row_id: 'P-2', updated_at: added.updated_at.toISOString(), label: 'Silk and more' } })
    await expectRefused(probe(manager, { op: 'undo', id: first.row_id, decision }), 417)
    expect(await placement('P-2')).toMatchObject({ label: 'Silk and more', retired_at: null })
    expect(asDay((await placement('P-1')).ends_on)).toBe('2026-11-04')
    const [still] = await probe(manager, { op: 'proposals', filter: { ids: [first.row_id] } })
    expect(still.state).toBe('Not yet reviewed')

    // The row it ended, edited since.
    await admin.post('/api/save_row', { table: 'Placement', row: { placement_id: 'P-OLD', label: 'Cotton', starts_on: '2026-10-01' } })
    const second = await probe(maker, ask(manager.user, { row: 'P-OLD', changes: {}, ends: true, apply: { effectiveOn: '2026-11-05' } }))
    const old = await placement('P-OLD')
    await admin.post('/api/save_row', { table: 'Placement', row: { row_id: 'P-OLD', updated_at: old.updated_at.toISOString(), label: 'Cotton blend' } })
    await expectRefused(probe(manager, { op: 'undo', id: second.row_id, decision }), 417)
  })

  test('refused when a later change replaced the added row', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    await setMode(admin, 'label_change', APPLY_NOW)
    const first = await probe(maker, ask(manager.user))
    await probe(other, ask(manager.user, { row: 'P-2', changes: { label: 'Wool' }, apply: apply('P-3') }))
    await expectRefused(probe(manager, { op: 'undo', id: first.row_id, decision: { approvers: approvers(manager.user), reason: 'Wrong' } }), 417)
    expect((await placement('P-2')).retired_at).toBeNull()
  })

  test('refused while a row in use still links to the added row; allowed once that link is retired', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await admin.post('/api/table_def', { name: 'Placement Note', columns: [{ column_name: 'placement', column_type: 'Reference', reference_table: 'Placement' }] })
    await setMode(admin, 'label_change', APPLY_NOW)
    const proposal = await probe(maker, ask(manager.user))
    const note = await admin.post<any>('/api/save_row', { table: 'Placement Note', row: { placement: 'P-2' } })
    const decision = { approvers: approvers(manager.user), reason: 'Wrong' }
    await expectRefused(probe(manager, { op: 'undo', id: proposal.row_id, decision }), 417)
    await admin.post(`/api/table/Placement%20Note/${encodeURIComponent(note.row_id)}:retire`, { reason: 'Gone' })
    expect((await probe(manager, { op: 'undo', id: proposal.row_id, decision })).state).toBe('Undone')
  })
})
