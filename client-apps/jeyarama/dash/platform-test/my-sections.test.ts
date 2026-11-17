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
  // The tree first: a subcategory's levels are references to it.
  for (const division of new Set(LEAVES.map(leaf => leaf[2]))) await save('Division', { division })
  for (const [subdivision, division] of new Map(LEAVES.map(leaf => [leaf[3], leaf[2]]))) await save('Subdivision', { subdivision, division })
  for (const [category, subdivision] of new Map(LEAVES.map(leaf => [leaf[4], leaf[3]]))) await save('Category', { category, subdivision })
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
  ['020101001', 'Girls Leggings', 'Kids', 'Girls Western', 'Western Bottoms'],
  ['020102001', 'Girls Leggings', 'Kids', 'Girls Ethnic', 'Ethnic Bottoms'],
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
      // One each in two categories: the first by name wins the tie.
      start: { division: 'Women', subdivision: 'Ethnic Wear', category: 'Kurtis and Sets' },
      levels: [
        { division: 'Kids', subdivision: 'Girls Ethnic', category: 'Ethnic Bottoms' },
        { division: 'Kids', subdivision: 'Girls Western', category: 'Western Bottoms' },
        { division: 'Women', subdivision: 'Ethnic Wear', category: 'Kurtis and Sets' },
        { division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses' },
      ] })
    await expect(read(maker, 'subcategory_levels', { job: 'JA-4' })).rejects.toMatchObject({ status: 417 })
  })

  test('a category\'s subcategories say who holds each at this store', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    const category = { job: 'JA-1', division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses' }
    expect(await read(maker, 'category_subcategories', category)).toEqual([
      { code: '010101001', name: 'Sarees', holder: { kind: 'mine' }, asked: false, taken_out: false },
      { code: '010101004', name: 'Sari Blouses', holder: { kind: 'none' }, asked: false, taken_out: false },
      { code: '010101003', name: 'Silk Sarees', holder: { kind: 'other', section: 'Silk', team_leader: 'Bala Holder' }, asked: false, taken_out: false },
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
    expect(seen.jobs[0].subcategories.find((s: any) => s.name === 'Sarees').pending).toEqual({ id: proposal.id, kind: 'removal', to: null, waiting_for: 'Mani Manager', applied: false })
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
    await expect(act(maker, 'propose_section', { job: 'JA-1' })).rejects.toMatchObject({ status: 417, message: expect.stringContaining('Pick a section in this store') })
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
      { id: sent[0].id, code: '010101004', name: 'Sari Blouses', division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses', waiting_for: 'Mani Manager', applied: false },
      { id: sent[1].id, code: '010101003', name: 'Silk Sarees', division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses', waiting_for: 'Mani Manager or Nila Other Manager', applied: false },
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
    expect(await read(editor, 'unplaced')).toEqual({ state: 'ok', rows: [{ store: 'Lakeside', code: '010101001', name: 'Sarees', division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses', was_in: 'Ladies Wear', since: today, put_back: null,
      removed_by: { name: 'Asha Maker', id: '1001', code: '1001', jobs: ['Team Leader · Lakeside'], staff: 'current' } }] })
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
    expect(mine.jobs[0].subcategories.find((s: any) => s.name === 'Sarees').pending).toEqual({ id, kind: 'move', to: 'Silk', waiting_for: 'Mani Manager', applied: false })
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
    const { maker, otherStaff, holderManager } = await world(admin, createUser)
    const proposal = await act(maker, 'propose_removal', removal())
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values (${randomUUID()}, ${maker.user!}, 'Person', 'roles', 'System Manager')`
    // Silk's manager has no say over a removal from Ladies Wear. A Master Data Editor has (#1219).
    for (const who of [maker, otherStaff, admin, holderManager])
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

// #1191: on an instance that sets Your sections to "Apply now, review after", a change happens
// when it is asked for; the reviewer confirms it or undoes it.
const applyNow = async (admin: TestClient) => {
  for (const type of ['subcategory_add', 'subcategory_removal', 'job_section'])
    await admin.post('/api/save_row', { table: 'Approval Type', row: { row_id: `dash.${type}`, mode: 'Apply now, review after' } })
}
const inForce = async (subcategory: string) => (await sql`select row_id, section from ${sql(await tableRelation('Section Subcategory'))}
  where store = 'LKS' and subcategory = ${subcategory} and retired_at is null and (ends_on is null or ends_on >= ${today}) order by row_id`).map(r => ({ row_id: r.row_id, section: r.section }))

describe('apply now, review after (#1191)', () => {
  test('the page says whether changes happen at once', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    expect((await read(maker, 'my_sections')).applies_at_once).toEqual({ add: false, removal: false, section: false })
    await applyNow(admin)
    expect((await read(maker, 'my_sections')).applies_at_once).toEqual({ add: true, removal: true, section: true })
  })

  test('Not mine takes it out at once; it shows struck through, waiting for review, and the reviewer sees it', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    await applyNow(admin)
    const proposal = await act(maker, 'propose_removal', removal())
    expect(proposal).toMatchObject({ kind: 'removal', state: 'Not yet reviewed', applied: true, waiting_for: 'Mani Manager' })
    expect(await inForce('010101001')).toEqual([])
    const seen = await read(maker, 'my_sections')
    expect(seen.jobs[0].subcategories.find((s: any) => s.name === 'Sarees').pending).toEqual({ id: proposal.id, kind: 'removal', to: null, waiting_for: 'Mani Manager', applied: true })
    expect(seen.proposals[0]).toMatchObject({ id: proposal.id, state: 'Not yet reviewed', applied: true })
    const waiting = await read(manager, 'approvals')
    expect(waiting.proposals).toEqual([expect.objectContaining({ id: proposal.id, kind: 'removal', applied: true, who: 'Asha Maker' })])
    expect((await read(manager, 'my_sections')).waiting_for_me).toBe(1)
  })

  test('adding puts it in their section at once, from nowhere or from another team leader, who both managers can review', async ({ admin, createUser }) => {
    const { maker, holderManager } = await world(admin, createUser)
    await applyNow(admin)
    const sent = await act(maker, 'propose_adds', adds('010101004', '010101003'))
    expect(sent.map((p: any) => p.state)).toEqual(['Not yet reviewed', 'Not yet reviewed'])
    expect(await inForce('010101004')).toEqual([{ row_id: `LKS-010101004-${today}`, section: 'LKS-S1' }])
    expect(await inForce('010101003')).toEqual([{ row_id: `LKS-010101003-${today}`, section: 'LKS-S1' }])
    expect((await row('Section Subcategory', `LKS-010101004-${today}`)).source_key).toBe(`Dash, applied ${today}`)
    const { jobs } = await read(maker, 'my_sections')
    // Shown once, as an addition, not also as a plain subcategory.
    expect(jobs[0].subcategories.map((s: any) => s.name)).toEqual(['Kurtis', 'Sarees'])
    expect(jobs[0].additions).toEqual([
      expect.objectContaining({ id: sent[0].id, name: 'Sari Blouses', applied: true, waiting_for: 'Mani Manager' }),
      expect.objectContaining({ id: sent[1].id, name: 'Silk Sarees', applied: true, waiting_for: 'Mani Manager or Nila Other Manager' }),
    ])
    expect((await read(holderManager, 'approvals')).proposals).toEqual([expect.objectContaining({ id: sent[1].id, kind: 'move', applied: true })])
  })

  test('a section change takes effect at once, and the job says what it changed from', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    await applyNow(admin)
    const proposal = await act(maker, 'propose_section', { job: 'JA-1', to_section: 'LKS-S2' })
    expect(proposal).toMatchObject({ kind: 'section', state: 'Not yet reviewed' })
    const { jobs } = await read(maker, 'my_sections')
    expect(jobs[0]).toMatchObject({ section: { name: 'Silk' }, section_change: { id: proposal.id, from: 'Ladies Wear', waiting_for: 'Mani Manager' } })
  })

  test('the reviewer confirms it: it stays, and the person reads that it was confirmed', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    await applyNow(admin)
    const [added] = await act(maker, 'propose_adds', adds('010101004'))
    await expect(act(manager, 'decide', { proposal: added.id, decision: 'approve' })).rejects.toMatchObject({ status: 417 })
    expect(await act(manager, 'decide', { proposal: added.id, decision: 'confirm' })).toMatchObject({ state: 'Confirmed' })
    expect(await inForce('010101004')).toHaveLength(1)
    expect((await read(maker, 'my_sections')).proposals[0]).toMatchObject({ state: 'Confirmed', decided_on: today })
    expect((await read(manager, 'approvals')).proposals).toEqual([])
    // A proposal still waiting is approved or rejected, never confirmed.
    await sql`delete from approval_type`
    const waiting = await act(maker, 'propose_removal', removal())
    await expect(act(manager, 'decide', { proposal: waiting.id, decision: 'confirm' })).rejects.toMatchObject({ status: 417 })
  })

  test('the reviewer undoes it with a reason: everything is as it was, and the person reads why', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    await applyNow(admin)
    const proposal = await act(maker, 'propose_removal', removal())
    await expect(act(manager, 'decide', { proposal: proposal.id, decision: 'undo', reason: ' ' })).rejects.toMatchObject({ status: 417 })
    expect(await act(manager, 'decide', { proposal: proposal.id, decision: 'undo', reason: 'Sarees stay with you' })).toMatchObject({ state: 'Undone' })
    expect(await inForce('010101001')).toEqual([{ row_id: 'LKS-1', section: 'LKS-S1' }])
    const seen = await read(maker, 'my_sections')
    expect(seen.jobs[0].subcategories.find((s: any) => s.name === 'Sarees').pending).toBeNull()
    expect(seen.proposals[0]).toMatchObject({ state: 'Undone', reason: 'Sarees stay with you' })
    await expect(act(maker, 'withdraw', { proposal: proposal.id })).rejects.toMatchObject({ status: 417 })
  })

  test('the person takes back their own with Undo, and can add it again the same day', async ({ admin, createUser }) => {
    const { maker, otherStaff } = await world(admin, createUser)
    await applyNow(admin)
    const [added] = await act(maker, 'propose_adds', adds('010101004'))
    await expect(act(otherStaff, 'withdraw', { proposal: added.id })).rejects.toMatchObject({ status: 417 })
    expect(await act(maker, 'withdraw', { proposal: added.id })).toMatchObject({ state: 'Undone' })
    expect(await inForce('010101004')).toEqual([])
    // The undone row keeps its identifier, retired: a new one is found beside it.
    const [again] = await act(maker, 'propose_adds', adds('010101004'))
    expect(again.state).toBe('Not yet reviewed')
    expect(await inForce('010101004')).toEqual([{ row_id: `LKS-010101004-${today}-2`, section: 'LKS-S1' }])
  })

  test('an undo that would put a subcategory back where someone has since put it elsewhere is refused', async ({ admin, createUser }) => {
    const { maker, manager, holder } = await world(admin, createUser)
    await applyNow(admin)
    const proposal = await act(maker, 'propose_removal', removal())
    // Silk's Team Leader adds it from nowhere.
    await act(holder, 'propose_adds', { job: 'JA-6', subcategories: ['010101001'] })
    await expect(act(manager, 'decide', { proposal: proposal.id, decision: 'undo', reason: 'Wrong' }))
      .rejects.toMatchObject({ status: 417, message: expect.stringContaining('has since been put in Silk') })
    await expect(act(maker, 'withdraw', { proposal: proposal.id })).rejects.toMatchObject({ status: 417 })
    const [still] = await sql`select proposal_state from change_proposal where row_id = ${proposal.id}`
    expect(still.proposal_state).toBe('Not yet reviewed')
  })

  test('changed by someone else since: undo refuses and says who', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    await applyNow(admin)
    const [added] = await act(maker, 'propose_adds', adds('010101004'))
    const placed = await row('Section Subcategory', `LKS-010101004-${today}`)
    await admin.post('/api/save_row', { table: 'Section Subcategory', row: { row_id: placed.row_id, updated_at: placed.updated_at.toISOString(), section: 'LKS-S2' } })
    await expect(act(manager, 'decide', { proposal: added.id, decision: 'undo', reason: 'Wrong' }))
      .rejects.toMatchObject({ status: 417, message: expect.stringContaining("so it can't be undone") })
  })

  test('taken out and not yet reviewed: adding it back is refused, pointing to Undo; their own undo reads as taken back', async ({ admin, createUser }) => {
    const { maker } = await world(admin, createUser)
    await applyNow(admin)
    const out = await act(maker, 'propose_removal', removal())
    await expect(act(maker, 'propose_adds', adds('010101001'))).rejects.toMatchObject({ status: 417, message: expect.stringContaining('Undo') })
    expect((await read(maker, 'category_subcategories', { job: 'JA-1', division: 'Women', subdivision: 'Ethnic Wear', category: 'Sarees and Blouses' }))
      .find((s: any) => s.code === '010101001')).toMatchObject({ holder: { kind: 'none' }, taken_out: true })
    await act(maker, 'withdraw', { proposal: out.id })
    expect((await read(maker, 'my_sections')).proposals[0]).toMatchObject({ id: out.id, state: 'Undone', taken_back: true })
  })
})


// #1254: Waiting for you read the asker's manager, and asked the platform who may decide, once per waiting change:
// 14 queries each, 5 s on production. What it reads must not grow with how many changes wait.
describe('what reading Waiting for you costs', () => {
  const scans = async () => Object.fromEntries((await sql`select relname, (coalesce(seq_scan, 0) + coalesce(idx_scan, 0))::int as n
    from pg_stat_xact_user_tables where schemaname = 'featherbase' and relname in ('employee', 'job_assignment', 'sign_in_method')`).map(r => [r.relname, r.n]))
  const cost = async (client: TestClient, name: string) => {
    const before = await scans()
    await read(client, name)
    const after = await scans()
    return Object.fromEntries(Object.keys(after).map(table => [table, after[table] - (before[table] ?? 0)]))
  }

  test('is the same for three waiting changes as for one', async ({ admin, createUser }) => {
    const { maker, manager } = await world(admin, createUser)
    await act(maker, 'propose_removal', removal())
    expect((await read(manager, 'approvals')).proposals).toHaveLength(1)
    const one = await cost(manager, 'approvals')
    await oldStyleMove(maker, manager, 'LKS-2', 'LKS-S2')
    await oldStyleMove(maker, manager, 'LKS-3', 'LKS-S1')
    expect((await read(manager, 'approvals')).proposals).toHaveLength(3)
    expect(await cost(manager, 'approvals')).toEqual(one)
  })

  // #1219: a Master Data Editor sees changes waiting on different managers, each named with whoever else has it.
  // (What the platform is asked is proved in src/my-sections.test.ts: one call, every manager in it. Index scans
  // here grow by one per person even on the manager's own read, so they can't measure that.)
  test('for a Master Data Editor, changes waiting on different managers each name their own', async ({ admin, createUser }) => {
    const { maker, holder, otherStaff, editor } = await world(admin, createUser)
    await act(maker, 'propose_removal', removal())
    await act(holder, 'propose_removal', { job: 'JA-6', placement: 'LKS-3' })
    await act(otherStaff, 'propose_section', { job: 'JA-4', to_section: 'LKS-S2' })
    // Other Staff's manager has no sign-in: it waits for the master data team, and names no one else.
    expect((await read(editor, 'approvals')).proposals.map((p: any) => p.also_with.map((r: any) => r.name)).sort()).toEqual([[], ['Mani Manager'], ['Nila Other Manager']])
  })

})

// #1219: a Master Data Editor acts on any open review as the person's manager can, and puts back
// what was taken out while its review is open. Reviewers are named with who they are (#1216).
describe('the master data team acts like the manager (#1219)', () => {
  const MANI = { name: 'Mani Manager', id: '1002', code: '1002', jobs: [], staff: 'current' }
  const proposalRow = async (id: string) => (await sql`select proposal_state, decided_by, decision_reason from change_proposal where row_id = ${id}`)[0]

  test('every open review is in their Waiting for you, beside the manager, who is named with who they are', async ({ admin, createUser }) => {
    const { maker, manager, editor, otherStaff, holderManager, stranger } = await world(admin, createUser)
    await applyNow(admin)
    const out = await act(maker, 'propose_removal', removal())
    await sql`delete from approval_type`
    const [asked] = await act(maker, 'propose_adds', adds('010101004'))
    const ids = (answer: any) => answer.proposals.map((p: any) => p.id).sort()
    expect(ids(await read(manager, 'approvals'))).toEqual([out.id, asked.id].sort())
    expect(ids(await read(editor, 'approvals'))).toEqual([out.id, asked.id].sort())
    // The editor is told who else has it; the manager is not told about themselves.
    expect((await read(editor, 'approvals')).proposals.map((p: any) => p.also_with)).toEqual([[MANI], [MANI]])
    expect((await read(manager, 'approvals')).proposals.map((p: any) => p.also_with)).toEqual([[], []])
    for (const who of [otherStaff, holderManager, stranger]) expect((await read(who, 'approvals')).proposals).toEqual([])
  })

  test('they confirm, undo with a reason, and approve, as the manager would; the review records them', async ({ admin, createUser }) => {
    const { maker, editor } = await world(admin, createUser)
    await applyNow(admin)
    const [added] = await act(maker, 'propose_adds', adds('010101004'))
    expect(await act(editor, 'decide', { proposal: added.id, decision: 'confirm' })).toMatchObject({ state: 'Confirmed' })
    expect(await proposalRow(added.id)).toMatchObject({ proposal_state: 'Confirmed', decided_by: editor.user })
    // Decided as the role: the platform read the role when it decided.
    expect(await sql`select role from change_proposal_approver where parent = ${added.id}`).toEqual([{ role: 'Master Data Editor' }])

    const out = await act(maker, 'propose_removal', removal())
    await expect(act(editor, 'decide', { proposal: out.id, decision: 'undo' })).rejects.toMatchObject({ status: 417 })
    expect(await act(editor, 'decide', { proposal: out.id, decision: 'undo', reason: 'Sarees stay in Ladies Wear' })).toMatchObject({ state: 'Undone' })
    expect(await inForce('010101001')).toEqual([{ row_id: 'LKS-1', section: 'LKS-S1' }])
    // The row put back is saved under their sign-in, so its history names them.
    expect((await row('Section Subcategory', 'LKS-1')).updated_by).toBe(editor.user)
    expect(await proposalRow(out.id)).toMatchObject({ decided_by: editor.user, decision_reason: 'Sarees stay in Ladies Wear' })
    expect((await read(maker, 'my_sections')).proposals.find((p: any) => p.id === out.id)).toMatchObject({ state: 'Undone', reason: 'Sarees stay in Ladies Wear', taken_back: false })

    await sql`delete from approval_type`
    const pending = await act(maker, 'propose_section', { job: 'JA-1', to_section: 'LKS-S2' })
    expect(await act(editor, 'decide', { proposal: pending.id, decision: 'approve' })).toMatchObject({ state: 'Applied' })
    expect(await proposalRow(pending.id)).toMatchObject({ decided_by: editor.user })
  })

  test('the role taken away before they decide: refused, though their request carried it', async ({ admin, createUser }) => {
    const { maker, editor } = await world(admin, createUser)
    await applyNow(admin)
    const out = await act(maker, 'propose_removal', removal())
    await sql`delete from has_role where parent = ${editor.user!} and role = 'Master Data Editor'`
    await expect(act(editor, 'decide', { proposal: out.id, decision: 'undo', reason: 'No' })).rejects.toMatchObject({ status: 417 })
    await expect(act(editor, 'put_back', { proposal: out.id })).rejects.toMatchObject({ status: 417 })
    expect((await proposalRow(out.id)).proposal_state).toBe('Not yet reviewed')
  })

  test('the manager keeps working as before, and once either decides, the other is told it is done', async ({ admin, createUser }) => {
    const { maker, manager, editor } = await world(admin, createUser)
    await applyNow(admin)
    const out = await act(maker, 'propose_removal', removal())
    expect(await act(manager, 'decide', { proposal: out.id, decision: 'confirm' })).toMatchObject({ state: 'Confirmed' })
    expect(await proposalRow(out.id)).toMatchObject({ decided_by: manager.user })
    await expect(act(editor, 'decide', { proposal: out.id, decision: 'undo', reason: 'Late' })).rejects.toMatchObject({ status: 417, message: expect.stringContaining('already been reviewed') })
    expect((await read(editor, 'approvals')).proposals).toEqual([])
  })

  test('refused: anyone else, the manager of another section, and an editor deciding their own', async ({ admin, createUser }) => {
    const { maker, editor, otherStaff, holderManager, stranger, save } = await world(admin, createUser)
    await applyNow(admin)
    const out = await act(maker, 'propose_removal', removal())
    for (const who of [otherStaff, holderManager, stranger]) {
      await expect(act(who, 'decide', { proposal: out.id, decision: 'undo', reason: 'No' })).rejects.toMatchObject({ status: 417 })
      await expect(act(who, 'put_back', { proposal: out.id })).rejects.toMatchObject({ status: 417 })
    }
    // The maker takes their own back with Undo, never with Put back.
    await expect(act(maker, 'put_back', { proposal: out.id })).rejects.toMatchObject({ status: 417 })
    expect(await inForce('010101001')).toEqual([])
    // An editor on the staff, as a Team Leader: their own change is never theirs to review.
    await save('Employee', { employee_code: '1005', name: 'Eli Editor', person: editor.user, status: 'Current' })
    await save('Job Assignment', { assignment_id: 'JA-5', employee: '1005', job: 'Team Leader', site: 'LKS', section: 'LKS-S2', reports_to: '1002', starts_on: '2026-10-01' })
    const own = await act(editor, 'propose_removal', { job: 'JA-5', placement: 'LKS-3' })
    expect((await read(editor, 'approvals')).proposals.map((p: any) => p.id)).toEqual([out.id])
    await expect(act(editor, 'decide', { proposal: own.id, decision: 'confirm' })).rejects.toMatchObject({ status: 417 })
    await expect(act(editor, 'put_back', { proposal: own.id })).rejects.toMatchObject({ status: 417 })
  })

  test('Put back, on Not in any section: back in the section it left, its review settled, gone from both lists', async ({ admin, createUser }) => {
    const { maker, manager, editor } = await world(admin, createUser)
    await applyNow(admin)
    const out = await act(maker, 'propose_removal', removal())
    const before = await read(editor, 'unplaced')
    expect(before.rows).toEqual([expect.objectContaining({ code: '010101001', was_in: 'Ladies Wear', put_back: { proposal: out.id } })])
    expect(await act(editor, 'put_back', { proposal: out.id })).toMatchObject({ state: 'Undone' })
    expect(await inForce('010101001')).toEqual([{ row_id: 'LKS-1', section: 'LKS-S1' }])
    expect(await proposalRow(out.id)).toMatchObject({ proposal_state: 'Undone', decided_by: editor.user, decision_reason: 'Put back in Ladies Wear by the master data team.' })
    expect((await read(editor, 'unplaced')).rows).toEqual([])
    expect((await read(manager, 'approvals')).proposals).toEqual([])
    expect((await read(maker, 'my_sections')).proposals[0]).toMatchObject({ id: out.id, state: 'Undone', reason: 'Put back in Ladies Wear by the master data team.' })
    // Settled now: a second put back is refused.
    await expect(act(editor, 'put_back', { proposal: out.id })).rejects.toMatchObject({ status: 417 })
  })

  test('no Put back once the removal is reviewed, or once it is in another section', async ({ admin, createUser }) => {
    const { maker, manager, editor, holder } = await world(admin, createUser)
    await applyNow(admin)
    const reviewed = await act(maker, 'propose_removal', removal())
    await act(manager, 'decide', { proposal: reviewed.id, decision: 'confirm' })
    expect((await read(editor, 'unplaced')).rows).toEqual([expect.objectContaining({ code: '010101001', put_back: null })])
    await expect(act(editor, 'put_back', { proposal: reviewed.id })).rejects.toMatchObject({ status: 417 })

    const moved = await act(maker, 'propose_removal', removal({ placement: 'LKS-2' }))
    await act(holder, 'propose_adds', { job: 'JA-6', subcategories: ['010101002'] })
    await expect(act(editor, 'put_back', { proposal: moved.id })).rejects.toMatchObject({ status: 417, message: expect.stringMatching(/has since been put in Silk, so it can't be put back$/) })
    expect((await proposalRow(moved.id)).proposal_state).toBe('Not yet reviewed')
  })

  test('only an open removal is put back: never an addition or a section change', async ({ admin, createUser }) => {
    const { maker, editor } = await world(admin, createUser)
    await applyNow(admin)
    const [added] = await act(maker, 'propose_adds', adds('010101004'))
    await expect(act(editor, 'put_back', { proposal: added.id })).rejects.toMatchObject({ status: 417 })
    expect((await proposalRow(added.id)).proposal_state).toBe('Not yet reviewed')
  })

  test('the person and their reviewers are named with who they are', async ({ admin, createUser }) => {
    const { maker, otherStaff } = await world(admin, createUser)
    await applyNow(admin)
    const out = await act(maker, 'propose_removal', removal())
    const page = await read(maker, 'my_sections')
    expect(page.jobs[0].reviewers).toEqual([MANI])
    expect(page.proposals.find((p: any) => p.id === out.id).reviewers).toEqual([MANI])
    expect(out.reviewers).toEqual([MANI])
    // The master data team is a team, not a person: nobody to name.
    expect((await read(otherStaff, 'my_sections')).jobs[0].reviewers).toEqual([])
  })
})

// #1219: Not in any section says who took each one out, with who they are (#1216).
describe('who took it out (#1219)', () => {
  test('a removal in Dash names the person who asked, a Master Data Editor included', async ({ admin, createUser }) => {
    const { maker, manager, editor, save } = await world(admin, createUser)
    await applyNow(admin)
    await act(maker, 'propose_removal', removal())
    const reviewed = await act(maker, 'propose_removal', removal({ placement: 'LKS-2' }))
    await act(manager, 'decide', { proposal: reviewed.id, decision: 'confirm' })
    // The editor, on the staff list as Silk's Team Leader, takes one out of their own section.
    await save('Employee', { employee_code: '1005', name: 'Eli Editor', person: editor.user, status: 'Current' })
    await save('Job Assignment', { assignment_id: 'JA-5', employee: '1005', job: 'Team Leader', site: 'LKS', section: 'LKS-S2', reports_to: '1002', starts_on: '2026-10-01' })
    await act(editor, 'propose_removal', { job: 'JA-5', placement: 'LKS-3' })
    const rows = (await read(editor, 'unplaced')).rows
    expect(Object.fromEntries(rows.map((r: any) => [r.name, r.removed_by]))).toEqual({
      Sarees: { name: 'Asha Maker', id: '1001', code: '1001', jobs: ['Team Leader · Lakeside'], staff: 'current' },
      Kurtis: { name: 'Asha Maker', id: '1001', code: '1001', jobs: ['Team Leader · Lakeside'], staff: 'current' },
      'Silk Sarees': { name: 'Eli Editor', id: '1005', code: '1005', jobs: ['Team Leader · Lakeside'], staff: 'current' },
    })
    // Their own removal is never theirs to put back.
    expect(rows.find((r: any) => r.name === 'Silk Sarees').put_back).toBeNull()
  })

  test('the latest end says who: a Dash removal, reopened, then ended again in Featherbase names whoever ended it last', async ({ admin, createUser }) => {
    const { maker, manager, editor } = await world(admin, createUser)
    await applyNow(admin)
    const out = await act(maker, 'propose_removal', removal())
    await act(manager, 'decide', { proposal: out.id, decision: 'confirm' })
    expect((await read(editor, 'unplaced')).rows[0].removed_by).toMatchObject({ name: 'Asha Maker' })
    // Reopened, then ended again, both by the Administrator in Featherbase.
    for (const ends_on of [null, yesterday]) {
      const placed = await row('Section Subcategory', 'LKS-1')
      await admin.post('/api/save_row', { table: 'Section Subcategory', row: { row_id: 'LKS-1', updated_at: placed.updated_at.toISOString(), ends_on } })
    }
    expect((await read(editor, 'unplaced')).rows[0].removed_by).toMatchObject({ name: 'Administrator', staff: 'none' })
  })

  test('one ended outside Dash names whoever saved it: staff by the staff list, anyone else by the platform\'s name for them', async ({ admin, createUser }) => {
    const { editor, save } = await world(admin, createUser)
    const endBy = async (id: string, actor: string | null) => {
      const placed = await row('Section Subcategory', id)
      await admin.post('/api/save_row', { table: 'Section Subcategory', row: { row_id: id, updated_at: placed.updated_at.toISOString(), ends_on: yesterday } })
      // As if that person or service had ended it: the row's own history says who set its end.
      if (actor) await sql`update ${sql(await tableRelation('Version'))} set created_by = ${actor}
        where ref_table = 'Section Subcategory' and ref_name = ${id} and exists (select 1 from jsonb_array_elements(data->'changed') c where c->>0 = 'ends_on')`
    }
    // In Featherbase, by a master data analyst on the staff list; by the Administrator; by an import's service account.
    await save('Employee', { employee_code: '1005', name: 'Eli Editor', person: editor.user, status: 'Current' })
    await save('Job Assignment', { assignment_id: 'JA-5', employee: '1005', job: 'Staff', site: 'HIL', starts_on: '2026-10-01' })
    await sql`insert into service_account (row_id, label, enabled) values ('svc_made_up_import', 'Made-up StyleHR import', true)`
    await endBy('LKS-1', editor.user!)
    await endBy('LKS-2', null)
    await endBy('LKS-3', 'svc_made_up_import')
    // Saved again later by someone else, in a column other than its end: who took it out stays the same.
    const sarees = await row('Section Subcategory', 'LKS-1')
    await admin.post('/api/save_row', { table: 'Section Subcategory', row: { row_id: 'LKS-1', updated_at: sarees.updated_at.toISOString(), source_key: 'Corrected later' } })
    const rows = (await read(editor, 'unplaced')).rows
    expect(Object.fromEntries(rows.map((r: any) => [r.name, r.removed_by]))).toEqual({
      Sarees: { name: 'Eli Editor', id: '1005', code: '1005', jobs: ['Staff · Hillview'], staff: 'current' },
      Kurtis: { name: 'Administrator', id: null, code: null, jobs: [], staff: 'none' },
      // The platform's own name for a service account (its actor-name helper), never its id.
      'Silk Sarees': { name: expect.stringMatching(/StyleHR import/), id: null, code: null, jobs: [], staff: 'none' },
    })
    expect(rows.every((r: any) => r.put_back === null)).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('svc_made_up_import')
  })

})
