import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import { makeClient, type TestClient, type CreateUserFn } from 'feather-testing-postgres'
import { test as pgTest } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { tableRelation } from '../src/table-engine'
import { expectRefused } from './fixtures'

// #975: the first slice of #627's Change Proposal, through a proof app that hands each helper
// call straight through. Every person, place and row here is made up.
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

async function setUp(admin: TestClient, createUser: CreateUserFn) {
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'proposalproof' })
  await admin.post('/api/table_def', { name: 'Placement', id_pattern: 'field:placement_id', track_changes: true, columns: [
    { column_name: 'placement_id', column_type: 'Data', reqd: true },
    { column_name: 'label', column_type: 'Data' }, { column_name: 'site', column_type: 'Data' },
    { column_name: 'secret', column_type: 'Data' },
    { column_name: 'layout_break', column_type: 'Section Break' },
    { column_name: 'starts_on', column_type: 'Date' }, { column_name: 'ends_on', column_type: 'Date' },
    { column_name: 'source', column_type: 'Data' },
  ] })
  await admin.post('/api/table_def', { name: 'Hidden Base', columns: [{ column_name: 'label', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'proposalproof.linked_tables', value: JSON.stringify(['Placement']) } })
  const row = await admin.post<any>('/api/save_row', { table: 'Placement', row: { placement_id: 'P-1', label: 'Sarees', site: 'North', secret: 'kept', starts_on: '2026-10-01' } })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Proof Editor' } })
  const maker = await createUser({ email: `maker-${randomUUID()}@example.test` })
  const manager = await createUser({ email: `manager-${randomUUID()}@example.test` })
  const other = await createUser({ email: `other-${randomUUID()}@example.test` })
  // Each can sign in with a password: an approver must have a working way in.
  await sql`update person set password_hash = 'made-up' where row_id in ${sql([maker.user!, manager.user!, other.user!])}`
  return { row, maker, manager, other }
}

const ask = (manager: string | null, change: Record<string, string | null> = { label: 'Silk' }, row: string | null = 'P-1') => ({
  op: 'propose', request: { table: 'Placement', row, changes: change, approvers: { people: manager ? [manager] : [], fallbackRoles: ['Proof Editor'] }, about: { kind: 'move' } },
})
const decision = (manager: string | null, more: object = {}) => ({ approvers: { people: manager ? [manager] : [], fallbackRoles: ['Proof Editor'] }, ...more })
const approval = (manager: string | null, stamp = 'P-2') => decision(manager, { effectiveOn: '2026-11-05', newRow: { placement_id: stamp, source: 'Proof' } })
const placement = async (id: string) => (await sql`select * from ${sql(await tableRelation('Placement'))} where row_id = ${id}`)[0]
const asDay = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : value)
const giveRole = (admin: TestClient, user: string | null, role: string) => sql`
  insert into has_role (row_id, parent, parenttype, parentfield, role) values (${randomUUID()}, ${user!}, 'Person', 'roles', ${role})`

describe('an app reads only what it declares and an administrator lists', () => {
  test('a person with no grant reads declared columns; anything else is refused', async ({ admin, createUser }) => {
    const { maker } = await setUp(admin, createUser)
    await expectRefused(maker.get('/api/table/Placement'), 403)
    expect(await probe(maker, { op: 'list', table: 'Placement', args: { fields: ['label'] } })).toEqual([{ label: 'Sarees' }])
    // Declared, not listed by the administrator.
    await expectRefused(probe(maker, { op: 'list', table: 'Hidden Base', args: { fields: ['label'] } }), 417)
    // A column it did not declare.
    await expectRefused(probe(maker, { op: 'list', table: 'Placement', args: { fields: ['secret'] } }), 417)
    // A filter or a sort on it reveals it just the same.
    await expectRefused(probe(maker, { op: 'list', table: 'Placement', args: { fields: ['label'], filters: [['secret', 'like', 'k%']] } }), 417)
    await expectRefused(probe(maker, { op: 'list', table: 'Placement', args: { fields: ['label'], order_by: 'secret asc' } }), 417)
    expect(await probe(maker, { op: 'list', table: 'Placement', args: { fields: ['label'], filters: [['site', '=', 'North']], order_by: 'row_id asc' } })).toEqual([{ label: 'Sarees' }])
    // No field list means no read.
    await expectRefused(probe(maker, { op: 'list', table: 'Placement', args: {} }), 417)
    // A Table it never declared, even a listed one.
    await expectRefused(probe(maker, { op: 'list', table: 'Person', args: { fields: ['email'] } }), 417)
  })

  test('a read handler can read but has nothing to propose or decide with', async ({ admin, createUser }) => {
    const { maker } = await setUp(admin, createUser)
    const { result } = await maker.post<any>('/api/app_reads/proposalproof/look', { payload: { table: 'Placement', args: { fields: ['label'] } } })
    expect(result).toEqual({ canPropose: false, canDecide: false, rows: [{ label: 'Sarees' }], proposals: [] })
  })
})

describe('a proposal changes nothing until it is approved', () => {
  test('propose records original and proposed, the row is untouched, and approve ends and adds', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    expect(proposal).toMatchObject({ state: 'Pending', maker: maker.user, target_table: 'Placement', target_row: 'P-1', about: { kind: 'move' },
      route: { people: [manager.user], roles: [] } })
    expect(proposal.changes).toContainEqual({ column_name: 'label', original_value: 'Sarees', proposed_value: 'Silk', review_base_value: 'Sarees' })
    expect(await placement('P-1')).toMatchObject({ label: 'Sarees', ends_on: null })

    const applied = await probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(manager.user) })
    expect(applied).toMatchObject({ state: 'Applied', decided_by: manager.user, result_row: 'P-2' })
    const old = await placement('P-1')
    expect(old.label).toBe('Sarees')
    expect(asDay(old.ends_on)).toBe('2026-11-04')
    const added = await placement('P-2')
    expect(added).toMatchObject({ label: 'Silk', site: 'North', secret: 'kept', source: 'Proof', ends_on: null, created_by: maker.user })
    expect(asDay(added.starts_on)).toBe('2026-11-05')
    // History names both, on both rows.
    for (const row of ['P-1', 'P-2']) {
      const events = await sql`select data from version where ref_table = 'Placement' and ref_name = ${row}`
      expect(events.map(e => e.data)).toContainEqual(expect.objectContaining({ change_proposal: proposal.row_id, made_by: maker.user, approved_by: manager.user }))
    }
  })

  test('a new row: nothing to end, and the row appears only on approval', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user, { label: 'Linen', site: 'North' }, null))
    expect((await sql`select count(*)::int as n from ${sql(await tableRelation('Placement'))}`)[0].n).toBe(1)
    await probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(manager.user, 'P-3') })
    expect(await placement('P-3')).toMatchObject({ label: 'Linen', site: 'North', created_by: maker.user })
    expect(asDay((await placement('P-3')).starts_on)).toBe('2026-11-05')
  })

  test('a row with no start date can be corrected', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await admin.post('/api/save_row', { table: 'Placement', row: { placement_id: 'P-NOSTART', label: 'Cotton' } })
    const proposal = await probe(maker, ask(manager.user, { label: 'Silk' }, 'P-NOSTART'))
    expect((await probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(manager.user, 'P-AFTER') })).state).toBe('Applied')
  })

  test('a row started on the approval day ends the day before: no day has two answers', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await admin.post('/api/save_row', { table: 'Placement', row: { placement_id: 'P-TODAY', label: 'Cotton', site: 'North', starts_on: '2026-11-05' } })
    const proposal = await probe(maker, ask(manager.user, { label: 'Silk' }, 'P-TODAY'))
    await probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(manager.user, 'P-4') })
    expect(asDay((await placement('P-TODAY')).ends_on)).toBe('2026-11-04')
  })

  test('reject needs a reason, records who and why, and changes nothing', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    await expectRefused(probe(manager, { op: 'reject', id: proposal.row_id, decision: decision(manager.user, { reason: '   ' }) }), 417)
    const rejected = await probe(manager, { op: 'reject', id: proposal.row_id, decision: decision(manager.user, { reason: 'It belongs where it is' }) })
    expect(rejected).toMatchObject({ state: 'Rejected', decided_by: manager.user, decision_reason: 'It belongs where it is' })
    expect(await placement('P-1')).toMatchObject({ label: 'Sarees', ends_on: null })
    await expectRefused(probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(manager.user) }), 417)
    expect(await placement('P-2')).toBeUndefined()
  })
})

describe('who may decide', () => {
  test('the maker never approves their own, whatever roles they hold, and an outsider cannot', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    await giveRole(admin, maker.user, 'System Manager')
    await giveRole(admin, maker.user, 'Proof Editor')
    await giveRole(admin, other.user, 'Proof Editor')
    const proposal = await probe(maker, ask(manager.user))
    await expectRefused(probe(maker, { op: 'approve', id: proposal.row_id, decision: approval(maker.user) }), 417)
    await expectRefused(probe(maker, { op: 'approve', id: proposal.row_id, decision: approval(manager.user) }), 417)
    // A role holder is not the approver while the manager can sign in.
    await expectRefused(probe(other, { op: 'approve', id: proposal.row_id, decision: approval(manager.user) }), 417)
    // Administrator is no exception.
    await expectRefused(probe(admin, { op: 'reject', id: proposal.row_id, decision: decision(manager.user, { reason: 'No' }) }), 417)
    expect(await placement('P-1')).toMatchObject({ label: 'Sarees', ends_on: null })
  })

  test('a manager who cannot sign in falls to the role, leaving the maker out', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    await sql`update person set enabled = false where row_id = ${manager.user}`
    await giveRole(admin, other.user, 'Proof Editor')
    const proposal = await probe(maker, ask(manager.user))
    expect(proposal.route).toEqual({ people: [], roles: ['Proof Editor'] })
    await probe(other, { op: 'approve', id: proposal.row_id, decision: approval(manager.user) })
    expect(asDay((await placement('P-1')).ends_on)).toBe('2026-11-04')
  })

  test('a manager with no working way to sign in falls to the role too', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    await sql`update person set password_hash = null where row_id = ${manager.user!}`
    await giveRole(admin, other.user, 'Proof Editor')
    expect((await probe(maker, ask(manager.user))).route).toEqual({ people: [], roles: ['Proof Editor'] })
  })

  test('a role whose only holder cannot sign in leaves nobody to approve', async ({ admin, createUser }) => {
    const { maker, other } = await setUp(admin, createUser)
    await giveRole(admin, other.user, 'Proof Editor')
    await sql`update person set password_hash = null where row_id = ${other.user!}`
    await expectRefused(probe(maker, ask(null)), 417)
  })

  test('a role holder with no way in left cannot decide, though another holder keeps the route open', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    await giveRole(admin, other.user, 'Proof Editor')
    await giveRole(admin, manager.user, 'Proof Editor')
    const proposal = await probe(maker, ask(null))
    await sql`update person set password_hash = null where row_id = ${other.user!}`
    await expectRefused(probe(other, { op: 'approve', id: proposal.row_id, decision: approval(null) }), 417)
    expect((await probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(null) })).state).toBe('Applied')
  })

  test('with nobody else to approve, the proposal is refused saying why', async ({ admin, createUser }) => {
    const { maker } = await setUp(admin, createUser)
    await giveRole(admin, maker.user, 'Proof Editor')
    await expectRefused(probe(maker, ask(null)), 417, 'Nobody else can approve')
    await expectRefused(probe(maker, ask(maker.user)), 417)
    expect((await sql`select count(*)::int as n from change_proposal`)[0].n).toBe(0)
  })

  test('a change of manager moves the proposal with it, and the old one loses it', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    await expectRefused(probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(other.user) }), 417)
    const applied = await probe(other, { op: 'approve', id: proposal.row_id, decision: approval(other.user) })
    expect(applied).toMatchObject({ state: 'Applied', route: { people: [other.user], roles: [] } })
  })
})

describe('what an app may propose', () => {
  test('only declared Tables and columns, on a row that exists, and a real change', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const approvers = { people: [manager.user], fallbackRoles: [] }
    await expectRefused(probe(maker, { op: 'propose', request: { table: 'Hidden Base', row: null, changes: { label: 'x' }, approvers } }), 417)
    await expectRefused(probe(maker, ask(manager.user, { secret: 'changed' })), 417)
    await expectRefused(probe(maker, ask(manager.user, { ends_on: '2020-01-01' })), 417)
    await expect(probe(maker, ask(manager.user, { label: 'Silk' }, 'NOT-A-ROW'))).rejects.toMatchObject({ status: expect.any(Number) })
    await expectRefused(probe(maker, ask(manager.user, { label: 'Sarees' })), 417)
    const first = await probe(maker, ask(manager.user))
    // Asking for the same again is refused, whatever unchanged column it also names; a different ask on the same row is allowed.
    await expectRefused(probe(maker, ask(manager.user)), 417)
    await expectRefused(probe(maker, ask(manager.user, { label: 'Silk', site: 'North' })), 417)
    // A new row asked for twice is the same ask; so is it, and only it.
    await probe(maker, ask(manager.user, { label: 'Hemp' }, null))
    await expectRefused(probe(maker, ask(manager.user, { label: 'Hemp' }, null)), 417)
    await probe(maker, ask(manager.user, { label: 'Linen' }))
    const stampless = decision(manager.user, { effectiveOn: '2026-11-05', newRow: { placement_id: 'P-9', secret: 'smuggled' } })
    await expectRefused(probe(manager, { op: 'approve', id: first.row_id, decision: stampless }), 417)
  })

  test('nobody reaches a proposal or its Table except through the platform', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    await expectRefused(admin.post('/api/save_row', { table: 'Change Proposal', row: { row_id: proposal.row_id, updated_at: 'x', proposal_state: 'Applied' } }), 403)
    await expectRefused(maker.get('/api/table/Change%20Proposal'), 403)
  })
})

describe('stale proposals', () => {
  test('a reviewed value that changed moves it to Needs fresh review and changes nothing', async ({ admin, createUser }) => {
    const { maker, manager, row } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    await admin.post('/api/save_row', { table: 'Placement', row: { row_id: 'P-1', updated_at: row.updated_at, label: 'Changed meanwhile' } })
    const outcome = await probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(manager.user) })
    expect(outcome).toMatchObject({ state: 'Needs fresh review' })
    expect(await placement('P-1')).toMatchObject({ label: 'Changed meanwhile', ends_on: null })
    expect(await placement('P-2')).toBeUndefined()
  })

  test('a reviewed column the proposal does not change must hold still too, and is not rewritten', async ({ admin, createUser }) => {
    const { maker, manager, row } = await setUp(admin, createUser)
    const request = ask(manager.user)
    const proposal = await probe(maker, { ...request, request: { ...request.request, reviewed: ['site'] } })
    await admin.post('/api/save_row', { table: 'Placement', row: { row_id: 'P-1', updated_at: row.updated_at, site: 'South' } })
    expect((await probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(manager.user) })).state).toBe('Needs fresh review')
    await expectRefused(probe(maker, { ...request, request: { ...request.request, reviewed: ['secret'] } }), 417)
  })

  test('a row with a planned end can be corrected; the new row keeps the plan, and a plan that has passed is stale', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await admin.post('/api/save_row', { table: 'Placement', row: { placement_id: 'P-PLAN', label: 'Cotton', starts_on: '2026-10-01', ends_on: '2026-12-31' } })
    const proposal = await probe(maker, ask(manager.user, { label: 'Silk' }, 'P-PLAN'))
    await probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(manager.user, 'P-NEXT') })
    expect(asDay((await placement('P-PLAN')).ends_on)).toBe('2026-11-04')
    expect(asDay((await placement('P-NEXT')).ends_on)).toBe('2026-12-31')
    await admin.post('/api/save_row', { table: 'Placement', row: { placement_id: 'P-OVER', label: 'Cotton', starts_on: '2026-10-01', ends_on: '2026-11-01' } })
    const late = await probe(maker, ask(manager.user, { label: 'Silk' }, 'P-OVER'))
    expect((await probe(manager, { op: 'approve', id: late.row_id, decision: approval(manager.user, 'P-LATE') })).state).toBe('Needs fresh review')
  })

  test('a row ended meanwhile is stale too, and an unrelated column is not', async ({ admin, createUser }) => {
    const { maker, manager, row } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    const edited = await admin.post<any>('/api/save_row', { table: 'Placement', row: { row_id: 'P-1', updated_at: row.updated_at, secret: 'unrelated edit' } })
    const second = await probe(maker, ask(manager.user, { label: 'Linen' }))
    await admin.post('/api/save_row', { table: 'Placement', row: { row_id: 'P-1', updated_at: edited.updated_at, ends_on: '2026-11-01' } })
    expect((await probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(manager.user) })).state).toBe('Needs fresh review')
    expect((await probe(manager, { op: 'approve', id: second.row_id, decision: approval(manager.user) })).state).toBe('Needs fresh review')
  })

  test('a row deleted meanwhile closes the proposal instead of stranding it', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    await sql`delete from ${sql(await tableRelation('Placement'))} where row_id = 'P-1'`
    expect((await probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(manager.user) })).state).toBe('Needs fresh review')
  })

  test('applying one sends the others on that row back for a fresh review', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const first = await probe(maker, ask(manager.user))
    const second = await probe(maker, ask(manager.user, { label: 'Linen' }))
    await probe(manager, { op: 'approve', id: first.row_id, decision: approval(manager.user) })
    const [listed] = await probe(maker, { op: 'proposals', filter: { ids: [second.row_id] } })
    expect(listed.state).toBe('Needs fresh review')
    await expectRefused(probe(manager, { op: 'approve', id: second.row_id, decision: approval(manager.user, 'P-5') }), 417)
  })

  test('the app can say a proposal has gone stale, and only the approver can', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    await expectRefused(probe(other, { op: 'needs_fresh_review', id: proposal.row_id, decision: decision(manager.user, { reason: 'x' }) }), 417)
    const outcome = await probe(manager, { op: 'needs_fresh_review', id: proposal.row_id, decision: decision(manager.user, { reason: 'The section closed' }) })
    expect(outcome).toMatchObject({ state: 'Needs fresh review', decision_reason: 'The section closed' })
  })
})

describe('holding authority still', () => {
  test('only a declared and listed row can be locked', async ({ admin, createUser }) => {
    const { maker } = await setUp(admin, createUser)
    expect(await probe(maker, { op: 'lock', table: 'Placement', row: 'P-1', key: 'a' })).toBe(true)
    await expectRefused(probe(maker, { op: 'lock', table: 'Hidden Base', row: 'x', key: 'a' }), 417)
    await expectRefused(probe(maker, { op: 'lock', table: 'Person', row: 'x', key: 'a' }), 417)
  })

  test('a read-only column keeps its value on the new row', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    await sql`update column_def set read_only = true where parent = 'Placement' and column_name = 'secret'`
    await invalidateMeta()
    const proposal = await probe(maker, ask(manager.user))
    await probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(manager.user) })
    expect((await placement('P-2')).secret).toBe('kept')
  })
})

describe('what the helpers refuse', () => {
  test('reads: a related filter, and a Table with Sub-tables or one that is the platform\'s', async ({ admin, createUser }) => {
    const { maker } = await setUp(admin, createUser)
    await expectRefused(probe(maker, { op: 'list', table: 'Placement', args: { fields: ['label'], filters: [['site', 'related', 'x']] } }), 417)
    await admin.post('/api/table_def', { name: 'Holder Child', kind: 'sub_table', columns: [{ column_name: 'label', column_type: 'Data' }] })
    await admin.post('/api/table_def', { name: 'Holder Base', columns: [{ column_name: 'label', column_type: 'Data' }, { column_name: 'kids', column_type: 'Sub-table', row_table: 'Holder Child' }] })
    const [setting] = await sql`select updated_at from app_setting where row_id = 'proposalproof.linked_tables'`
    await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'proposalproof.linked_tables', updated_at: setting.updated_at, value: JSON.stringify(['Placement', 'Holder Base', 'Holder Child', 'Role']) } })
    for (const table of ['Holder Base', 'Holder Child', 'Role'])
      await expect(probe(maker, { op: 'list', table, args: { fields: ['row_id'] } }), table).rejects.toMatchObject({ status: 417 })
  })

  test('helpers run one at a time, and none outlives its handler', async ({ admin, createUser }) => {
    const { maker } = await setUp(admin, createUser)
    await expectRefused(probe(maker, { op: 'parallel' }), 417)
    await expectRefused(probe(maker, { op: 'unawaited' }), 417)
    // A helper left running that then fails still fails the handler, with its own reason.
    await expectRefused(probe(maker, { op: 'unawaited_failing' }), 417)
  })

  test('proposing: nothing to change, a value that is not text, a column both changed and reviewed, bad approvers', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const base = ask(manager.user).request
    await expectRefused(probe(maker, { op: 'propose' }), 417)
    for (const request of [{ table: 'Placement', row: 'P-1', approvers: base.approvers }, { ...base, changes: {} }, { ...base, changes: { label: 7 } }, { ...base, reviewed: ['label'] }, { ...base, approvers: { people: 'x' } }, { ...base, approvers: undefined }])
      await expectRefused(probe(maker, { op: 'propose', request }), 417)
    expect((await sql`select count(*)::int as n from change_proposal`)[0].n).toBe(0)
  })

  test('deciding: a bad day, no reason, no proposal; a row that starts after the day is stale', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    await expectRefused(probe(manager, { op: 'approve', id: proposal.row_id, decision: decision(manager.user, { effectiveOn: 'soon' }) }), 417)
    await expectRefused(probe(manager, { op: 'needs_fresh_review', id: proposal.row_id, decision: decision(manager.user, {}) }), 417)
    await expectRefused(probe(manager, { op: 'reject', id: '', decision: decision(manager.user, { reason: 'x' }) }), 417)
    await expectRefused(probe(manager, { op: 'reject', id: proposal.row_id, decision: decision(manager.user) }), 417)
    await expect(probe(manager, { op: 'approve', id: proposal.row_id, decision: decision(manager.user, { effectiveOn: '2026-11-05' }) })).rejects.toMatchObject({ status: expect.any(Number) })
    expect((await probe(manager, { op: 'approve', id: proposal.row_id, decision: decision(manager.user, { effectiveOn: '2026-09-01', newRow: { placement_id: 'P-EARLY' } }) })).state).toBe('Needs fresh review')
  })

  test('locks and keys need something to name', async ({ admin, createUser }) => {
    const { maker } = await setUp(admin, createUser)
    await expectRefused(probe(maker, { op: 'lock', table: 'Placement', row: '', key: 'a' }), 417)
    await expectRefused(probe(maker, { op: 'lock', table: 'Placement', row: 'P-1', key: '' }), 417)
  })

  test('authority can be asked before deciding, by an action and by a read', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    await giveRole(admin, other.user, 'Proof Editor')
    const asks = (approvers: object) => ({ maker: maker.user, approvers })
    expect(await probe(manager, { op: 'authority', ...asks({ people: [manager.user], fallbackRoles: [] }) })).toEqual({ may: true, route: { people: [manager.user], roles: [] } })
    expect(await probe(maker, { op: 'authority', ...asks({ people: [manager.user], fallbackRoles: [] }) })).toMatchObject({ may: false })
    expect(await probe(manager, { op: 'authority', ...asks({ people: [], fallbackRoles: [] }) })).toEqual({ may: false, route: null })
    const { result } = await other.post<any>('/api/app_reads/proposalproof/look', { payload: { authority: asks({ people: [], fallbackRoles: ['Proof Editor'] }) } })
    expect(result).toEqual({ may: true, route: { people: [], roles: ['Proof Editor'] } })
  })
})

describe('listing', () => {
  test('lists only this app\'s proposals, by state and maker', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    await sql`update change_proposal set app = 'someone_else' where row_id = ${(await probe(other, ask(manager.user, { label: 'Linen' }))).row_id}`
    expect((await probe(manager, { op: 'proposals', filter: {} })).map((p: any) => p.row_id)).toEqual([proposal.row_id])
    expect((await probe(manager, { op: 'proposals', filter: { makers: [other.user] } }))).toEqual([])
    expect((await probe(manager, { op: 'proposals', filter: { states: ['Rejected'] } }))).toEqual([])
    for (const filter of [{ ids: [] }, { states: [] }, { makers: [] }]) expect(await probe(manager, { op: 'proposals', filter })).toEqual([])
    await expectRefused(probe(manager, { op: 'approve', id: 'no-such', decision: approval(manager.user) }), 404)
  })
})

// #1175: undo, a removal with nothing in its place, and an approver who puts it elsewhere.
describe('the maker withdraws, a proposal ends a row, an approver applies another value', () => {
  test('the maker withdraws a pending proposal; nobody else can, and a decided one stays decided', async ({ admin, createUser }) => {
    const { maker, manager, other } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    await expectRefused(probe(other, { op: 'withdraw', id: proposal.row_id }), 417)
    await expectRefused(probe(manager, { op: 'withdraw', id: proposal.row_id }), 417)
    expect(await probe(maker, { op: 'withdraw', id: proposal.row_id })).toMatchObject({ state: 'Withdrawn', decided_by: maker.user })
    await expectRefused(probe(maker, { op: 'withdraw', id: proposal.row_id }), 417, 'The person who asked has withdrawn this')
    await expectRefused(probe(manager, { op: 'approve', id: proposal.row_id, decision: approval(manager.user) }), 417, 'The person who asked has withdrawn this')
    expect(await placement('P-1')).toMatchObject({ label: 'Sarees', ends_on: null })
    // Asking again after withdrawing is a new proposal, not a repeat.
    const again = await probe(maker, ask(manager.user))
    await probe(manager, { op: 'approve', id: again.row_id, decision: approval(manager.user) })
    await expectRefused(probe(maker, { op: 'withdraw', id: again.row_id }), 417, 'This has already been decided')
  })

  test('an ending ends the row the day before and adds nothing', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const ending = (row: string | null = 'P-1', changes: Record<string, string> = {}) => ({ op: 'propose', request: { table: 'Placement', row, changes, ends: true,
      approvers: { people: [manager.user], fallbackRoles: [] }, about: { kind: 'removal' } } })
    await expectRefused(probe(maker, ending(null)), 417)
    await expectRefused(probe(maker, ending('P-1', { label: 'Silk' })), 417)
    const proposal = await probe(maker, ending())
    expect(proposal).toMatchObject({ state: 'Pending', ends_row: true, target_row: 'P-1' })
    await expectRefused(probe(maker, ending()), 417, 'You have already asked for this')
    // A change to the same row is a different ask.
    const other = await probe(maker, ask(manager.user))
    const applied = await probe(manager, { op: 'approve', id: proposal.row_id, decision: decision(manager.user, { effectiveOn: '2026-11-05' }) })
    expect(applied).toMatchObject({ state: 'Applied', result_row: null })
    expect(asDay((await placement('P-1')).ends_on)).toBe('2026-11-04')
    expect((await sql`select count(*)::int as n from ${sql(await tableRelation('Placement'))}`)[0].n).toBe(1)
    expect((await probe(maker, { op: 'proposals', filter: { ids: [other.row_id] } }))[0].state).toBe('Needs fresh review')
    const events = await sql`select data from version where ref_table = 'Placement' and ref_name = 'P-1'`
    expect(events.map(e => e.data)).toContainEqual(expect.objectContaining({ change_proposal: proposal.row_id, approved_by: manager.user }))
  })

  test('refused: an ending flag that is not true or false, ending a row that already ends, and non-text values or reasons', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const request = (row: string, ends: unknown) => ({ op: 'propose', request: { table: 'Placement', row, changes: {}, ends, approvers: { people: [manager.user], fallbackRoles: [] }, about: { kind: 'removal' } } })
    await expectRefused(probe(maker, request('P-1', 'yes')), 417, 'Expected ends to be true or false')
    await admin.post('/api/save_row', { table: 'Placement', row: { placement_id: 'P-ENDING', label: 'Linen', starts_on: '2026-10-01', ends_on: '2026-12-31' } })
    await expectRefused(probe(maker, request('P-ENDING', true)), 417, 'That already has an end')
    const proposal = await probe(maker, ask(manager.user))
    await expectRefused(probe(manager, { op: 'approve', id: proposal.row_id, decision: { ...approval(manager.user), instead: { label: 7 } } }), 417, 'Proposed values are text')
    await expectRefused(probe(manager, { op: 'approve', id: proposal.row_id, decision: { ...approval(manager.user), reason: 7 } }), 417, 'A reason is text')
    expect((await probe(maker, { op: 'proposals', filter: { ids: [proposal.row_id] } }))[0].state).toBe('Pending')
  })

  test('an approver applies another value for a column the proposal changes, and says so', async ({ admin, createUser }) => {
    const { maker, manager } = await setUp(admin, createUser)
    const proposal = await probe(maker, ask(manager.user))
    await expectRefused(probe(manager, { op: 'approve', id: proposal.row_id, decision: { ...approval(manager.user), instead: { site: 'South' } } }), 417)
    const applied = await probe(manager, { op: 'approve', id: proposal.row_id, decision: { ...approval(manager.user), instead: { label: 'Linen' }, reason: 'Put in Linen instead.' } })
    expect(applied).toMatchObject({ state: 'Applied', result_row: 'P-2', decision_reason: 'Put in Linen instead.' })
    expect(await placement('P-2')).toMatchObject({ label: 'Linen', site: 'North' })
  })
})
