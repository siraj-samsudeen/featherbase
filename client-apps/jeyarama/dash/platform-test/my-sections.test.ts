// Your sections (#975) on the real platform: every rule through the app's own reads and actions.
// The base Tables hold made-up stores and people only.
import { randomUUID } from 'node:crypto'
import { describe, expect, vi } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test as pgTest } from '../pg-test'
import { sql } from '../../src/db'
import { tableRelation } from '../../src/table-engine'
import { createCoreTables, installApp, pinned, saveRow } from './helpers'

vi.setConfig({ testTimeout: 60_000 })
process.env.MOTHERDUCK_TOKEN = 'made-up-token'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
const read = async (client: TestClient, name: string, payload: object = {}) =>
  (await client.post<any>(`/api/app_reads/dash/${name}`, { payload })).result
const act = async (client: TestClient, name: string, payload: object) =>
  (await client.post<any>(`/api/app_actions/dash/${name}`, { idempotencyKey: randomUUID(), payload })).result
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
const asDay = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : value)
const row = async (table: string, id: string) => (await sql`select * from ${sql(await tableRelation(table))} where row_id = ${id}`)[0]
const READER = { roles: ['Dash Reader'] }

async function world(admin: TestClient, createUser: CreateUserFn) {
  await installApp(admin)
  await createCoreTables(admin, [])
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Master Data Editor' } })
  const save = (table: string, values: Record<string, unknown>) => saveRow(admin, table, values)
  const person = (name: string, roles = READER.roles) => createUser({ email: `${name}-${randomUUID()}@example.test`, roles })
  const [maker, manager, editor, stranger, otherStaff, holder, holderManager] = await Promise.all(['maker', 'manager', 'editor', 'stranger', 'other', 'holder', 'holder-manager'].map(n => person(n)))
  // Each can sign in: an approver must have a working way in.
  await sql`update person set password_hash = 'made-up' where row_id in ${sql([maker, manager, editor, stranger, otherStaff, holder, holderManager].map(p => p.user!))}`
  await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values (${randomUUID()}, ${editor.user!}, 'Person', 'roles', 'Master Data Editor')`
  for (const [code, name] of [['LKS', 'Lakeside'], ['HIL', 'Hillview']]) await save('Site', { code, name, is_store: true })
  await save('Store Floor', { row_id: 'LKS-F1', name: 'First floor', site: 'LKS' })
  await save('Store Floor', { row_id: 'LKS-F2', name: 'Second floor', site: 'LKS' })
  await save('Store Floor', { row_id: 'LKS-F3', name: 'Third floor', site: 'LKS' })
  await save('Section', { row_id: 'LKS-S1', name: 'Ladies Wear', site: 'LKS', floor: 'LKS-F1', status: 'Active' })
  await save('Section', { row_id: 'LKS-S2', name: 'Silk', site: 'LKS', floor: 'LKS-F2', status: 'Active' })
  await save('Section', { row_id: 'LKS-S3', name: 'Closed Corner', site: 'LKS', floor: 'LKS-F2', status: 'Inactive' })
  await save('Section', { row_id: 'HIL-S1', name: 'Hillview Silk', site: 'HIL', status: 'Active' })
  for (const [code, name, division, subdivision, category] of LEAVES)
    await save('Subcategory', { row_id: code, subcategory: name, division, subdivision, category, subcategory_type: 'Merchandise' })
  await save('Subcategory', { row_id: '990101001', subcategory: 'Sari Hangers', subcategory_type: 'Consumable' })
  for (const [id, sub, section] of [['LKS-1', '010101001', 'LKS-S1'], ['LKS-2', '010101002', 'LKS-S1'], ['LKS-3', '010101003', 'LKS-S2']])
    await save('Section Subcategory', { section_subcategory_id: id, store: 'LKS', subcategory: sub, section, starts_on: '2026-10-01' })
  await save('Employee', { employee_code: '1001', name: 'Asha Maker', person: maker.user, status: 'Current' })
  await save('Employee', { employee_code: '1002', name: 'Mani Manager', person: manager.user, status: 'Current' })
  await save('Employee', { employee_code: '1003', name: 'No Login Manager', status: 'Current' })
  await save('Employee', { employee_code: '1004', name: 'Other Staff', person: otherStaff.user, status: 'Current' })
  const job = await save('Job Assignment', { assignment_id: 'JA-1', employee: '1001', job: 'Team Leader', site: 'LKS', section: 'LKS-S1', reports_to: '1002', starts_on: '2026-10-01' })
  await save('Job Assignment', { assignment_id: 'JA-4', employee: '1004', job: 'Staff', site: 'LKS', reports_to: '1003', starts_on: '2026-10-01' })
  // Silk's Team Leader, with a manager of their own.
  await save('Employee', { employee_code: '1006', name: 'Bala Holder', person: holder.user, status: 'Current' })
  await save('Employee', { employee_code: '1007', name: 'Nila Other Manager', person: holderManager.user, status: 'Current' })
  await save('Job Assignment', { assignment_id: 'JA-6', employee: '1006', job: 'Team Leader', site: 'LKS', section: 'LKS-S2', reports_to: '1007', starts_on: '2026-10-01' })
  return { maker, manager, editor, stranger, otherStaff, holder, holderManager, job, save }
}

/** Made-up leaves: two named Girls Leggings, told apart by their sub-division. */
const LEAVES = [
  ['010101001', 'Sarees', 'Women', 'Ethnic Wear', 'Sarees and Blouses'],
  ['010101002', 'Kurtis', 'Women', 'Ethnic Wear', 'Kurtis and Sets'],
  ['010101003', 'Silk Sarees', 'Women', 'Ethnic Wear', 'Sarees and Blouses'],
  ['010101004', 'Sari Blouses', 'Women', 'Ethnic Wear', 'Sarees and Blouses'],
  ['020101001', 'Girls Leggings', 'Kids', 'Girls Western', 'Bottoms'],
  ['020102001', 'Girls Leggings', 'Kids', 'Girls Ethnic', 'Bottoms'],
]
const removal = (over: object = {}) => ({ job: 'JA-1', placement: 'LKS-1', ...over })
const adds = (...subcategories: string[]) => ({ job: 'JA-1', subcategories })

/** A proposal as the old "pick where it goes" flow wrote it (production still holds some). */
async function oldStyleMove(maker: TestClient, manager: TestClient, placement = 'LKS-1', to = 'LKS-S2') {
  const id = randomUUID()
  const [row_] = await sql`select * from ${sql(await tableRelation('Section Subcategory'))} where row_id = ${placement}`
  await sql`insert into change_proposal (row_id, app, target_table, target_row, maker, proposal_state, about) values (${id}, 'dash', 'Section Subcategory', ${placement}, ${maker.user!}, 'Pending',
    ${sql.json({ kind: 'move', what: 'Sarees', from: 'Ladies Wear', to: 'Silk', store: 'Lakeside', site: 'LKS', maker_name: 'Asha Maker', manager_name: 'Mani Manager', job_assignment: 'JA-1', subcategory: row_.subcategory, from_section: row_.section, to_section: to })})`
  for (const [position, [column, before, after]] of [['section', row_.section, to], ['store', 'LKS', 'LKS'], ['subcategory', row_.subcategory, row_.subcategory], ['ends_on', null, null]].entries())
    await sql`insert into change_proposal_column (row_id, parent, parenttype, parentfield, position, column_name, original_value, proposed_value, review_base_value)
      values (${randomUUID()}, ${id}, 'Change Proposal', 'changes', ${position}, ${column}, ${before}, ${after}, ${before})`
  await sql`insert into change_proposal_approver (row_id, parent, parenttype, parentfield, position, person) values (${randomUUID()}, ${id}, 'Change Proposal', 'approvers', 0, ${manager.user!})`
  return id
}


describe('what a person sees', () => {
  test('their job, store, manager, section with floor and subcategories by name, each with its path', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    const answer = await read(maker, 'my_sections')
    expect(answer).toMatchObject({ state: 'ok', name: 'Asha Maker', proposals: [], waiting_for_me: 0 })
    expect(answer.jobs).toHaveLength(1)
    expect(answer.jobs[0]).toMatchObject({ job: 'Team Leader', store: 'Lakeside', reports_to: 'Mani Manager', waiting_for: 'Mani Manager',
      section: { name: 'Ladies Wear', floor: 'First floor' }, additions: [] })
    expect(answer.jobs[0].subcategories).toEqual([
      { id: 'LKS-2', code: '010101002', name: 'Kurtis', division: 'Women', subdivision: 'Ethnic Wear', category: 'Kurtis and Sets', pending: null },
      { id: 'LKS-1', code: '010101001', name: 'Sarees', division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses', pending: null },
    ])
    // Open sections of this store only: not the closed one, not another store's, not their own.
    expect(answer.jobs[0].other_sections.map((s: any) => s.name)).toEqual(['Silk'])
    expect(JSON.stringify(answer)).not.toContain('Other Staff')
  })

  test('a job with no section, someone the staff list does not know, and an instance not set up', async ({ admin, createUser }) => {
    const { otherStaff, stranger } = await world(admin, createUser)
    const answer = await read(otherStaff, 'my_sections')
    expect(answer.jobs[0]).toMatchObject({ section: null, subcategories: [], reports_to: 'No Login Manager', waiting_for: 'the master data team' })
    expect(await read(stranger, 'my_sections')).toEqual({ state: 'unknown_person' })
    const [setting] = await sql`select updated_at from app_setting where row_id = 'dash.linked_tables'`
    await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'dash.linked_tables', updated_at: setting.updated_at, value: '[]' } })
    expect(await read(stranger, 'my_sections')).toEqual({ state: 'not_set_up' })
  })

  test('staff read all this with no grant on the base Tables, which stay closed to them', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    await expect(maker.get('/api/table/Employee')).rejects.toMatchObject({ status: 403 })
    await expect(maker.get('/api/table/Job%20Assignment')).rejects.toMatchObject({ status: 403 })
  })
})

describe('browsing to add', () => {
  test('the levels start at their own division and sub-division', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    expect(await read(maker, 'subcategory_levels', { job: 'JA-1' })).toEqual({
      start: { division: 'Women', subdivision: 'Ethnic Wear' },
      levels: [
        { division: 'Kids', subdivision: 'Girls Ethnic', category: 'Bottoms' },
        { division: 'Kids', subdivision: 'Girls Western', category: 'Bottoms' },
        { division: 'Women', subdivision: 'Ethnic Wear', category: 'Kurtis and Sets' },
        { division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses' },
      ] })
    await expect(read(maker, 'subcategory_levels', { job: 'JA-4' })).rejects.toMatchObject({ status: 417 })
  })

  test('a category\'s subcategories say who holds each at this store', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    const category = { job: 'JA-1', division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses' }
    expect(await read(maker, 'category_subcategories', category)).toEqual([
      { code: '010101001', name: 'Sarees', holder: { kind: 'mine' }, asked: false },
      { code: '010101004', name: 'Sari Blouses', holder: { kind: 'none' }, asked: false },
      { code: '010101003', name: 'Silk Sarees', holder: { kind: 'other', section: 'Silk', team_leader: 'Bala Holder' }, asked: false },
    ])
    await act(maker, 'propose_adds', adds('010101004'))
    expect((await read(maker, 'category_subcategories', category))[1]).toMatchObject({ code: '010101004', asked: true })
  })
})

describe('what a person may propose', () => {
  test('Not mine asks to remove it, with no destination, and the row stays', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_removal', removal())
    expect(proposal).toMatchObject({ kind: 'removal', what: 'Sarees', from: 'Ladies Wear', store: 'Lakeside', state: 'Pending', waiting_for: 'Mani Manager' })
    expect(await row('Section Subcategory', 'LKS-1')).toMatchObject({ section: 'LKS-S1', ends_on: null })
    const seen = await read(maker, 'my_sections')
    expect(seen.proposals).toEqual([expect.objectContaining({ id: proposal.id, state: 'Pending' })])
    expect(seen.jobs[0].subcategories.find((s: any) => s.name === 'Sarees').pending).toEqual({ id: proposal.id, kind: 'removal', to: null, waiting_for: 'Mani Manager' })
    await expect(act(maker, 'propose_removal', removal())).rejects.toMatchObject({ status: 417 })
    expect((await read(manager, 'approvals')).proposals).toEqual([expect.objectContaining({ id: proposal.id, kind: 'removal', who: 'Asha Maker',
      path: { division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses' }, from: { section: 'Ladies Wear', holder: 'Asha Maker' }, to: null })])
  })

  test('Undo withdraws it at once; only theirs, only while it waits', async ({ admin, createUser }) => {
    const { maker, manager, otherStaff } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_removal', removal())
    await expect(act(otherStaff, 'withdraw', { proposal: proposal.id })).rejects.toMatchObject({ status: 417 })
    expect(await act(maker, 'withdraw', { proposal: proposal.id })).toMatchObject({ state: 'Withdrawn' })
    const seen = await read(maker, 'my_sections')
    expect(seen.jobs[0].subcategories.find((s: any) => s.name === 'Sarees').pending).toBeNull()
    expect(seen.proposals[0]).toMatchObject({ state: 'Withdrawn' })
    expect((await read(manager, 'approvals')).proposals).toEqual([])
    const again = await act(maker, 'propose_removal', removal())
    await act(manager, 'decide', { proposal: again.id, decision: 'approve' })
    await expect(act(maker, 'withdraw', { proposal: again.id })).rejects.toMatchObject({ status: 417 })
  })

  test('refused: not their section, not their job, another store\'s section', async ({ admin, createUser }) => {
    const { maker, otherStaff, stranger } = await world(admin, createUser)
    await expect(act(maker, 'propose_removal', removal({ placement: 'LKS-3' }))).rejects.toMatchObject({ status: 417 })
    await expect(act(maker, 'propose_section', { job: 'JA-1', to_section: 'HIL-S1' })).rejects.toMatchObject({ status: 417 })
    await expect(act(maker, 'propose_section', { job: 'JA-1', to_section: 'LKS-S3' })).rejects.toMatchObject({ status: 417 })
    await expect(act(otherStaff, 'propose_removal', removal())).rejects.toMatchObject({ status: 417 })
    await expect(act(otherStaff, 'propose_section', { job: 'JA-1', to_section: 'LKS-S2' })).rejects.toMatchObject({ status: 417 })
    await expect(act(stranger, 'propose_section', { job: 'JA-1', to_section: 'LKS-S2' })).rejects.toMatchObject({ status: 417 })
    expect((await sql`select count(*)::int as n from change_proposal`)[0].n).toBe(0)
  })

  test('adding several at once: one proposal each, shown as additions; one bad code sends none', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    await expect(act(maker, 'propose_adds', adds('010101004', '010101001'))).rejects.toMatchObject({ status: 417 })
    await expect(act(maker, 'propose_adds', adds('010101004', '990101001'))).rejects.toMatchObject({ status: 417 })
    await expect(act(maker, 'propose_adds', adds())).rejects.toMatchObject({ status: 417 })
    expect((await sql`select count(*)::int as n from change_proposal`)[0].n).toBe(0)
    const sent = await act(maker, 'propose_adds', adds('010101004', '010101003'))
    expect(sent).toEqual([
      expect.objectContaining({ kind: 'add', what: 'Sari Blouses', from: 'No section', to: 'Ladies Wear', waiting_for: 'Mani Manager' }),
      expect.objectContaining({ kind: 'add', what: 'Silk Sarees', from: 'Silk', to: 'Ladies Wear', waiting_for: 'Mani Manager or Nila Other Manager' }),
    ])
    const { jobs } = await read(maker, 'my_sections')
    expect(jobs[0].additions).toEqual([
      { id: sent[0].id, code: '010101004', name: 'Sari Blouses', division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses', waiting_for: 'Mani Manager' },
      { id: sent[1].id, code: '010101003', name: 'Silk Sarees', division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses', waiting_for: 'Mani Manager or Nila Other Manager' },
    ])
    await expect(act(maker, 'propose_adds', adds('010101004'))).rejects.toMatchObject({ status: 417 })
  })

  test('a change already planned for later is not overlapped', async ({ admin, createUser }) => {
    const { maker, manager, save } = await world(admin, createUser)
    const [asked] = await act(maker, 'propose_adds', adds('010101003'))
    await save('Section Subcategory', { section_subcategory_id: 'LATER', store: 'LKS', subcategory: '010101004', section: 'LKS-S2', starts_on: '2099-01-01' })
    await expect(act(maker, 'propose_adds', adds('010101004'))).rejects.toMatchObject({ status: 417 })
    await save('Section Subcategory', { section_subcategory_id: 'LATER2', store: 'LKS', subcategory: '010101003', section: 'LKS-S1', starts_on: '2099-01-01' })
    expect(await act(manager, 'decide', { proposal: asked.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
  })

  test('with nobody else to approve, it is refused saying so', async ({ admin, createUser }) => {
    const { otherStaff, editor } = await world(admin, createUser)
    await sql`delete from has_role where parent = ${editor.user!} and role = 'Master Data Editor'`
    await expect(act(otherStaff, 'propose_section', { job: 'JA-4', to_section: 'LKS-S2' })).rejects.toMatchObject({ status: 417, message: expect.stringContaining('Nobody else can approve') })
  })
})

describe('what an approver decides', () => {
  test('an approved removal leaves it in no section, on the master data team\'s list until it is added', async ({ admin, createUser }) => {
    const { maker, manager, editor, otherStaff } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_removal', removal())
    expect((await read(otherStaff, 'approvals')).proposals).toEqual([])
    expect((await read(maker, 'approvals')).proposals).toEqual([])
    expect(await act(manager, 'decide', { proposal: proposal.id, decision: 'approve' })).toMatchObject({ state: 'Applied' })
    expect(asDay((await row('Section Subcategory', 'LKS-1')).ends_on)).toBe(yesterday)
    expect((await sql`select count(*)::int as n from ${sql(await tableRelation('Section Subcategory'))} where subcategory = '010101001' and ends_on is null`)[0].n).toBe(0)
    const after = await read(maker, 'my_sections')
    expect(after.jobs[0].subcategories.map((s: any) => s.name)).toEqual(['Kurtis'])
    expect(after.proposals[0]).toMatchObject({ state: 'Applied', decided_on: today })
    expect(await read(maker, 'unplaced')).toEqual({ state: 'not_allowed' })
    expect(await read(editor, 'unplaced')).toEqual({ state: 'ok', rows: [{ store: 'Lakeside', code: '010101001', name: 'Sarees', division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses', was_in: 'Ladies Wear', since: today }] })
    expect(await read(editor, 'holds_master_data')).toBe(true)
    expect(await read(maker, 'holds_master_data')).toBe(false)
    // Asked for again, it shows as in no section, and leaves the list once added.
    expect((await read(maker, 'category_subcategories', { job: 'JA-1', division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses' }))
      .find((s: any) => s.code === '010101001').holder).toEqual({ kind: 'none' })
    const [back] = await act(maker, 'propose_adds', adds('010101001'))
    await act(manager, 'decide', { proposal: back.id, decision: 'approve' })
    expect((await read(editor, 'unplaced')).rows).toEqual([])
  })

  test('taking one from another team leader is a move both managers see, and either decides it', async ({ admin, createUser }) => {
    const { maker, manager, holderManager, holder } = await world(admin, createUser)
    const [asked] = await act(maker, 'propose_adds', adds('010101003'))
    const shown = { id: asked.id, kind: 'move', what: 'Silk Sarees', who: 'Asha Maker', store: 'Lakeside',
      path: { division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses' },
      from: { section: 'Silk', holder: 'Bala Holder' }, to: { section: 'Ladies Wear', holder: 'Asha Maker' } }
    expect((await read(manager, 'approvals')).proposals).toEqual([expect.objectContaining(shown)])
    expect((await read(holderManager, 'approvals')).proposals).toEqual([expect.objectContaining(shown)])
    // The approver can put it in another section instead: the store's open sections are offered.
    expect((await read(manager, 'approvals')).proposals[0].sections.map((s: any) => s.name)).toEqual(['Ladies Wear', 'Silk'])
    expect((await read(holder, 'approvals')).proposals).toEqual([])
    await act(holderManager, 'decide', { proposal: asked.id, decision: 'approve' })
    expect(asDay((await row('Section Subcategory', 'LKS-3')).ends_on)).toBe(yesterday)
    expect(await row('Section Subcategory', `LKS-010101003-${today}`)).toMatchObject({ section: 'LKS-S1', ends_on: null })
    expect((await read(manager, 'approvals')).proposals).toEqual([])
  })

  test('a move where neither manager can sign in waits for the master data team', async ({ admin, createUser }) => {
    const { maker, manager, holderManager, editor } = await world(admin, createUser)
    const [first] = await act(maker, 'propose_adds', adds('010101003'))
    await act(manager, 'decide', { proposal: first.id, decision: 'reject', reason: 'Silk Sarees stay in Silk' })
    await sql`update person set enabled = false where row_id in ${sql([manager.user!, holderManager.user!])}`
    const [second] = await act(maker, 'propose_adds', adds('010101003'))
    expect(second.waiting_for).toBe('the master data team')
    expect((await read(editor, 'approvals')).proposals.map((p: any) => p.id)).toEqual([second.id])
  })

  test('Move it elsewhere puts it in the section the approver picks, and says so', async ({ admin, createUser }) => {
    const { maker, manager, save } = await world(admin, createUser)
    await save('Section', { row_id: 'LKS-S4', name: 'Girls Ethnic', site: 'LKS', floor: 'LKS-F3', status: 'Active' })
    const [asked] = await act(maker, 'propose_adds', adds('010101003'))
    await expect(act(manager, 'decide', { proposal: asked.id, decision: 'approve', to_section: 'HIL-S1' })).rejects.toMatchObject({ status: 417 })
    await expect(act(manager, 'decide', { proposal: asked.id, decision: 'approve', to_section: 'LKS-S3' })).rejects.toMatchObject({ status: 417 })
    await expect(act(manager, 'decide', { proposal: asked.id, decision: 'approve', to_section: 'LKS-S2' })).rejects.toMatchObject({ status: 417 })
    expect(await act(manager, 'decide', { proposal: asked.id, decision: 'approve', to_section: 'LKS-S4' })).toMatchObject({ state: 'Applied', reason: 'Put in Girls Ethnic instead.' })
    expect(await row('Section Subcategory', `LKS-010101003-${today}`)).toMatchObject({ section: 'LKS-S4', ends_on: null })
    expect((await read(maker, 'my_sections')).jobs[0].subcategories.map((s: any) => s.name)).toEqual(['Kurtis', 'Sarees'])
  })

  test('a proposal made the old way, with a destination, shows as a move and is still decided', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    const id = await oldStyleMove(maker, manager)
    expect((await read(manager, 'approvals')).proposals).toEqual([expect.objectContaining({ id, kind: 'move', what: 'Sarees',
      from: { section: 'Ladies Wear', holder: 'Asha Maker' }, to: { section: 'Silk', holder: 'Bala Holder' } })])
    const mine = await read(maker, 'my_sections')
    expect(mine.jobs[0].subcategories.find((s: any) => s.name === 'Sarees').pending).toEqual({ id, kind: 'move', to: 'Silk', waiting_for: 'Mani Manager' })
    expect(await act(manager, 'decide', { proposal: id, decision: 'approve' })).toMatchObject({ state: 'Applied' })
    expect(await row('Section Subcategory', `LKS-010101001-${today}`)).toMatchObject({ section: 'LKS-S2' })
  })

  test('a section change ends and adds the job, keeping everything else', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_section', { job: 'JA-1', to_section: 'LKS-S2' })
    expect(proposal).toMatchObject({ kind: 'section', from: 'Ladies Wear', to: 'Silk', state: 'Pending' })
    await act(manager, 'decide', { proposal: proposal.id, decision: 'approve' })
    expect(asDay((await row('Job Assignment', 'JA-1')).ends_on)).toBe(yesterday)
    const added = await row('Job Assignment', `JA-1001-LKS-S2-${today}`)
    expect(added).toMatchObject({ employee: '1001', job: 'Team Leader', site: 'LKS', section: 'LKS-S2', reports_to: '1002', ends_on: null })
    expect((await read(maker, 'my_sections')).jobs[0].section.name).toBe('Silk')
  })

  test('a rejection needs a reason, changes nothing, and the person reads it', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_removal', removal())
    await expect(act(manager, 'decide', { proposal: proposal.id, decision: 'reject' })).rejects.toMatchObject({ status: 417 })
    await act(manager, 'decide', { proposal: proposal.id, decision: 'reject', reason: 'Sarees stay with Ladies Wear' })
    expect(await row('Section Subcategory', 'LKS-1')).toMatchObject({ section: 'LKS-S1', ends_on: null })
    expect((await read(maker, 'my_sections')).proposals[0]).toMatchObject({ state: 'Rejected', reason: 'Sarees stay with Ladies Wear' })
  })

  test('nobody decides their own or someone else\'s, System Manager included', async ({ admin, createUser }) => {
    const { maker, otherStaff, editor, holderManager } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_removal', removal())
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values (${randomUUID()}, ${maker.user!}, 'Person', 'roles', 'System Manager')`
    // Silk's manager has no say over a removal from Ladies Wear.
    for (const who of [maker, otherStaff, editor, admin, holderManager])
      await expect(act(who, 'decide', { proposal: proposal.id, decision: 'approve' })).rejects.toBeTruthy()
    expect(await row('Section Subcategory', 'LKS-1')).toMatchObject({ section: 'LKS-S1', ends_on: null })
  })

  test('with a manager who has no sign-in, a Master Data Editor decides, and never their own', async ({ admin, createUser }) => {
    const { otherStaff, editor, manager, save } = await world(admin, createUser)
    const proposal = await act(otherStaff, 'propose_section', { job: 'JA-4', to_section: 'LKS-S2' })
    expect(proposal.waiting_for).toBe('the master data team')
    expect((await read(manager, 'approvals')).proposals).toEqual([])
    expect((await read(editor, 'approvals')).proposals.map((p: any) => p.id)).toEqual([proposal.id])
    await expect(act(manager, 'decide', { proposal: proposal.id, decision: 'approve' })).rejects.toMatchObject({ status: 417 })
    // An editor on the staff asks about their own job: they see it as theirs, not as one to approve.
    await save('Employee', { employee_code: '1005', name: 'Eli Editor', person: editor.user, status: 'Current' })
    await save('Job Assignment', { assignment_id: 'JA-5', employee: '1005', job: 'Staff', site: 'LKS', starts_on: '2026-10-01' })
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values (${randomUUID()}, ${manager.user!}, 'Person', 'roles', 'Master Data Editor')`
    const own = await act(editor, 'propose_section', { job: 'JA-5', to_section: 'LKS-S2' })
    expect((await read(editor, 'approvals')).proposals.map((p: any) => p.id)).toEqual([proposal.id])
    await expect(act(editor, 'decide', { proposal: own.id, decision: 'approve' })).rejects.toMatchObject({ status: 417 })
    await act(editor, 'decide', { proposal: proposal.id, decision: 'approve' })
    expect(asDay((await row('Job Assignment', 'JA-4')).ends_on)).toBe(yesterday)
  })

  test('a section closed, a section moved on, or a row changed: Needs fresh review, nothing changes', async ({ admin, createUser }) => {
    const { maker, manager, job } = await world(admin, createUser)
    const [closed] = await act(maker, 'propose_adds', adds('010101004'))
    const [section] = await sql`select updated_at from ${sql(await tableRelation('Section'))} where row_id = 'LKS-S1'`
    const shut = await saveRow(admin, 'Section', { row_id: 'LKS-S1', updated_at: section.updated_at, status: 'Inactive' })
    expect(await act(manager, 'decide', { proposal: closed.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    await saveRow(admin, 'Section', { row_id: 'LKS-S1', updated_at: shut.updated_at, status: 'Active' })
    const moved = await act(maker, 'propose_removal', removal({ placement: 'LKS-2' }))
    await saveRow(admin, 'Job Assignment', { row_id: 'JA-1', updated_at: job.updated_at, section: 'LKS-S2' })
    expect(await act(manager, 'decide', { proposal: moved.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    expect(await row('Section Subcategory', 'LKS-2')).toMatchObject({ section: 'LKS-S1', ends_on: null })
    expect((await read(maker, 'my_sections')).proposals.every((p: any) => p.state === 'Needs fresh review')).toBe(true)
  })

  test('a placement that now holds another subcategory is not what was reviewed', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_removal', removal())
    const [placement] = await sql`select updated_at from ${sql(await tableRelation('Section Subcategory'))} where row_id = 'LKS-1'`
    await saveRow(admin, 'Section Subcategory', { row_id: 'LKS-1', updated_at: placement.updated_at, subcategory: '010101004' })
    expect(await act(manager, 'decide', { proposal: proposal.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    expect(await row('Section Subcategory', 'LKS-1')).toMatchObject({ section: 'LKS-S1', ends_on: null })
  })

  test('a section that moved floor since the ask is not what was reviewed', async ({ admin, createUser }) => {
    const { manager, maker } = await world(admin, createUser)
    const { updated_at } = (await sql`select updated_at from ${sql(await tableRelation('Job Assignment'))} where row_id = 'JA-1'`)[0]
    await saveRow(admin, 'Job Assignment', { row_id: 'JA-1', updated_at, floor: 'LKS-F1' })
    const proposal = await act(maker, 'propose_section', { job: 'JA-1', to_section: 'LKS-S2' })
    const [section] = await sql`select updated_at from ${sql(await tableRelation('Section'))} where row_id = 'LKS-S2'`
    await saveRow(admin, 'Section', { row_id: 'LKS-S2', updated_at: section.updated_at, floor: 'LKS-F3' })
    expect(await act(manager, 'decide', { proposal: proposal.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
  })

  test('a section on the same floor that moves before approval is not what was reviewed either', async ({ admin, createUser }) => {
    const { manager, maker } = await world(admin, createUser)
    const { updated_at } = (await sql`select updated_at from ${sql(await tableRelation('Job Assignment'))} where row_id = 'JA-1'`)[0]
    await saveRow(admin, 'Job Assignment', { row_id: 'JA-1', updated_at, floor: 'LKS-F2' })
    const proposal = await act(maker, 'propose_section', { job: 'JA-1', to_section: 'LKS-S2' })
    const [section] = await sql`select updated_at from ${sql(await tableRelation('Section'))} where row_id = 'LKS-S2'`
    await saveRow(admin, 'Section', { row_id: 'LKS-S2', updated_at: section.updated_at, floor: 'LKS-F3' })
    expect(await act(manager, 'decide', { proposal: proposal.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
    expect(await row('Job Assignment', 'JA-1')).toMatchObject({ section: 'LKS-S1', ends_on: null })
  })

  test('a section closed behind the person: nothing more is asked out of it', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    const [section] = await sql`select updated_at from ${sql(await tableRelation('Section'))} where row_id = 'LKS-S1'`
    await saveRow(admin, 'Section', { row_id: 'LKS-S1', updated_at: section.updated_at, status: 'Inactive' })
    await expect(act(maker, 'propose_removal', removal())).rejects.toMatchObject({ status: 417 })
    await expect(act(maker, 'propose_adds', adds('010101004'))).rejects.toMatchObject({ status: 417 })
  })

  test('a subcategory no longer sold as merchandise since the ask is not added', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    const [proposal] = await act(maker, 'propose_adds', adds('010101004'))
    const [row_] = await sql`select updated_at from ${sql(await tableRelation('Subcategory'))} where row_id = '010101004'`
    await saveRow(admin, 'Subcategory', { row_id: '010101004', updated_at: row_.updated_at, subcategory_type: 'Consumable' })
    expect(await act(manager, 'decide', { proposal: proposal.id, decision: 'approve' })).toMatchObject({ state: 'Needs fresh review' })
  })

  test('a pending proposal says who it waits for now, as the job changes hands', async ({ admin, createUser }) => {
    const { maker, otherStaff, job } = await world(admin, createUser)
    await act(maker, 'propose_removal', removal())
    await saveRow(admin, 'Job Assignment', { row_id: 'JA-1', updated_at: job.updated_at, reports_to: '1004' })
    expect((await read(maker, 'my_sections')).proposals[0].waiting_for).toBe('Other Staff')
    await sql`update person set enabled = false where row_id = ${otherStaff.user!}`
    expect((await read(maker, 'my_sections')).proposals[0].waiting_for).toBe('the master data team')
  })

  test('a manager Dash does not open for is passed over, for the master data team', async ({ admin, createUser }) => {
    const { maker, manager, editor } = await world(admin, createUser)
    await sql`delete from has_role where parent = ${manager.user!} and role = 'Dash Reader'`
    const proposal = await act(maker, 'propose_removal', removal())
    expect(proposal.waiting_for).toBe('the master data team')
    expect((await read(editor, 'approvals')).proposals.map((p: any) => p.id)).toEqual([proposal.id])
    // An editor Dash doesn't open for can't take it either: then nobody can, and it says so.
    await sql`delete from has_role where parent = ${editor.user!} and role = 'Dash Reader'`
    await expect(act(maker, 'propose_removal', removal({ placement: 'LKS-2' }))).rejects.toMatchObject({ status: 417, message: expect.stringContaining('Nobody else can approve') })
  })

  test('the same day twice: the new rows do not collide, and today has one answer', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    const first = await act(maker, 'propose_section', { job: 'JA-1', to_section: 'LKS-S2' })
    await act(manager, 'decide', { proposal: first.id, decision: 'approve' })
    const second = await act(maker, 'propose_section', { job: `JA-1001-LKS-S2-${today}`, to_section: 'LKS-S1' })
    await act(manager, 'decide', { proposal: second.id, decision: 'approve' })
    const third = await act(maker, 'propose_section', { job: `JA-1001-LKS-S1-${today}`, to_section: 'LKS-S2' })
    await act(manager, 'decide', { proposal: third.id, decision: 'approve' })
    const { jobs } = await read(maker, 'my_sections')
    expect(jobs.map((j: any) => j.section.name)).toEqual(['Silk'])
  })
})
