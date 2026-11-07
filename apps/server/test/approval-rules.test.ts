import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect } from 'vitest'
import type { TestClient, CreateUserFn } from 'feather-testing-postgres'
import { test } from './pg-test'
import { grantRole } from './fixtures'
import { discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'
import { tableRelation } from '../src/table-engine'

// #627: approval rules, on the issue's generic fixtures. A Shelf has a site and a label; roles
// Site Lead, Helper and Region Lead; the proof app names a row's site lead from Shelf Site.
// Every person, place and row here is made up.
const directory = resolve('../..', 'test-apps/approval-proof')
const SITE_LEAD = 'approvalproof.site_lead'

interface World {
  lead: TestClient; helper: TestClient; region: TestClient; manager: TestClient; other: TestClient
  shelf: (id: string) => Promise<Record<string, any>>
  mails: (to: TestClient) => Promise<{ subject: string; body: string }[]>
}

async function setUp(admin: TestClient, createUser: CreateUserFn): Promise<World> {
  expect(await discoverPackages([directory])).toEqual([])
  await admin.post('/api/install_app', { name: 'approvalproof' })
  await admin.post('/api/table_def', { name: 'Shelf Site', id_pattern: 'field:code', columns: [
    { column_name: 'code', column_type: 'Data', reqd: true }, { column_name: 'lead', column_type: 'Data' }] })
  await admin.post('/api/table_def', { name: 'Shelf', id_pattern: 'prompt', track_changes: true, columns: [
    { column_name: 'site', column_type: 'Data' }, { column_name: 'label', column_type: 'Data' }, { column_name: 'bay', column_type: 'Int' }] })
  for (const role of ['Site Lead', 'Helper', 'Region Lead'])
    await grantRole(admin, { role, table: 'Shelf', can_read: true, can_write: true, can_create: true })
  const user = async (name: string, roles: string[]) => {
    const client = await createUser({ email: `${name}-${randomUUID()}@example.test`, roles })
    await sql`update person set password_hash = 'made-up' where row_id = ${client.user!}`
    return client
  }
  const lead = await user('lead', ['Site Lead'])
  const helper = await user('helper', ['Helper'])
  const region = await user('region', ['Region Lead'])
  const manager = await user('manager', ['System Manager'])
  const other = await user('other', ['Site Lead'])
  for (const [code, person] of [['A', lead.user], ['B', other.user], ['C', helper.user]])
    await admin.post('/api/save_row', { table: 'Shelf Site', row: { code, lead: person } })
  for (const [id, site] of [['S-1', 'A'], ['S-2', 'A'], ['S-3', 'A'], ['S-9', 'B'], ['S-7', 'C']])
    await admin.post('/api/save_row', { table: 'Shelf', row: { row_id: id, site, label: 'Blue box', bay: 1 } })
  return {
    lead, helper, region, manager, other,
    shelf: async (id) => (await sql`select * from ${sql(await tableRelation('Shelf'))} where row_id = ${id}`)[0],
    mails: async (to) => {
      const [person] = await sql`select email from person where row_id = ${to.user!}`
      return (await sql`select subject, body from email_queue where recipient = ${person.email as string} order by created_at`) as never
    },
  }
}

type Rule = Record<string, unknown>
const rule = (admin: TestClient, values: Rule) => admin.post<any>('/api/save_row', { table: 'Approval Rule', row: {
  ref_table: 'Shelf', operations: 'Changes and new rows', outcome: 'Route to approvers', approvals_needed: 'All', approvers: [], ...values } })
// The issue's first rules: a Helper's change waits for the row's site lead; the site lead's own applies.
async function helperWaitsForLead(admin: TestClient, more: Rule = {}) {
  await rule(admin, { description: 'Helpers ask the site lead', maker_role: 'Helper', approvers: [{ resolver: SITE_LEAD }], ...more })
  await rule(admin, { description: 'Site lead decides', maker_resolver: SITE_LEAD, outcome: 'Apply and log' })
}
const edit = async (client: TestClient, id: string, values: Record<string, unknown>) => {
  const current = await client.get<any>(`/api/table/Shelf/${id}`)
  const response = await client.fetch('/api/save_row', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table: 'Shelf', row: { row_id: id, updated_at: current.updated_at, ...values } }) })
  return { status: response.status, body: await response.json() as any }
}
const approve = (client: TestClient, id: string) => client.post<any>(`/api/change_proposals/${id}/approve`, {})

describe('a maker\'s change waits for the approver', () => {
  test('a Helper\'s change leaves the row alone, shows as pending and emails the site lead', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin)
    const { status, body } = await edit(w.helper, 'S-1', { label: 'Red box' })
    expect(status).toBe(202)
    expect(body.label).toBe('Blue box')
    expect(body.pending_proposal).toMatchObject({ state: 'Pending' })
    expect((await w.shelf('S-1')).label).toBe('Blue box')
    const { proposals } = await w.lead.get<any>('/api/row_proposals/Shelf/S-1')
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({ maker: w.helper.user, state: 'Pending', operation: 'update', can_decide: true,
      changes: [{ column_name: 'label', original_value: 'Blue box', proposed_value: 'Red box', review_base_value: 'Blue box' }] })
    // The maker sees it, and can't decide it.
    expect((await w.helper.get<any>('/api/row_proposals/Shelf/S-1')).proposals[0].can_decide).toBe(false)
    const mail = await w.mails(w.lead)
    expect(mail).toHaveLength(1)
    expect(mail[0].subject).toBe('Approval required: Shelf S-1')
    expect(mail[0].body).toContain('Available actions: Approve, Reject')
    expect(await w.mails(w.helper)).toEqual([])
    expect((await w.lead.get<any>('/api/change_proposals/waiting')).proposals.map((p: any) => p.target_row)).toEqual(['S-1'])
    expect((await w.region.get<any>('/api/change_proposals/waiting')).proposals).toEqual([])
  })

  test('the site lead approves: the row changes, and history names the maker and the approver', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin)
    const { body } = await edit(w.helper, 'S-1', { label: 'Red box', bay: 4 })
    // The maker can't approve their own, whatever roles they hold.
    await expect(approve(w.helper, body.pending_proposal.row_id)).rejects.toMatchObject({ status: 403 })
    // Someone the rule doesn't name can't either.
    await expect(approve(w.region, body.pending_proposal.row_id)).rejects.toMatchObject({ status: 403 })
    const decided = await approve(w.lead, body.pending_proposal.row_id)
    expect(decided).toMatchObject({ state: 'Applied', decided_by: w.lead.user, result_row: 'S-1' })
    expect(await w.shelf('S-1')).toMatchObject({ label: 'Red box', bay: 4, updated_by: w.helper.user })
    const [version] = await sql`select created_by, data from version where ref_table = 'Shelf' and ref_name = 'S-1' order by created_at desc limit 1`
    expect(version.created_by).toBe(w.helper.user)
    expect(version.data).toMatchObject({ change_proposal: body.pending_proposal.row_id, made_by: w.helper.user, approved_by: [w.lead.user] })
    await expect(approve(w.lead, body.pending_proposal.row_id)).rejects.toMatchObject({ status: 417 })
  })

  test('approving needs no edit permission on the row', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await grantRole(admin, { role: 'Checker', table: [] })
    const checker = await createUser({ email: `checker-${randomUUID()}@example.test`, roles: ['Checker'] })
    await sql`update person set password_hash = 'made-up' where row_id = ${checker.user!}`
    await rule(admin, { maker_role: 'Helper', approvers: [{ role: 'Checker' }] })
    const { body } = await edit(w.helper, 'S-1', { label: 'Red box' })
    await expect(checker.get('/api/table/Shelf/S-1')).rejects.toMatchObject({ status: 403 })
    expect(await approve(checker, body.pending_proposal.row_id)).toMatchObject({ state: 'Applied' })
    expect((await w.shelf('S-1')).label).toBe('Red box')
  })

  test('the site lead rejects with a reason, and the row is unchanged', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin)
    const { body } = await edit(w.helper, 'S-1', { label: 'Red box' })
    const id = body.pending_proposal.row_id
    await expect(w.lead.post(`/api/change_proposals/${id}/reject`, { reason: ' ' })).rejects.toMatchObject({ status: 417 })
    expect(await w.lead.post<any>(`/api/change_proposals/${id}/reject`, { reason: 'Wrong shelf' }))
      .toMatchObject({ state: 'Rejected', decided_by: w.lead.user, decision_reason: 'Wrong shelf' })
    expect((await w.shelf('S-1')).label).toBe('Blue box')
  })

  test('nobody else could approve: the only approver is the maker, so the change is refused', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin)
    // The Helper leads site C.
    const { status, body } = await edit(w.helper, 'S-7', { label: 'Red box' })
    expect(status).toBe(403)
    expect(body.message ?? JSON.stringify(body)).toMatch(/Nobody else can approve/)
    expect((await w.shelf('S-7')).label).toBe('Blue box')
  })

  test('a value that changed meanwhile asks for a fresh review, then approving again applies it', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin)
    const { body } = await edit(w.helper, 'S-1', { label: 'Red box' })
    const id = body.pending_proposal.row_id
    // The site lead's own change applies at once.
    expect((await edit(w.lead, 'S-1', { label: 'Green box' })).status).toBe(201)
    expect(await approve(w.lead, id)).toMatchObject({ state: 'Needs fresh review', changes: [{ original_value: 'Blue box', review_base_value: 'Green box', proposed_value: 'Red box' }] })
    expect((await w.shelf('S-1')).label).toBe('Green box')
    expect(await approve(w.lead, id)).toMatchObject({ state: 'Applied' })
    expect((await w.shelf('S-1')).label).toBe('Red box')
  })

  test('approving one sends another pending change to the same column back for a fresh review', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin)
    const first = (await edit(w.helper, 'S-1', { label: 'Red box' })).body.pending_proposal.row_id
    const second = (await edit(w.helper, 'S-1', { label: 'Grey box' })).body.pending_proposal.row_id
    const bay = (await edit(w.helper, 'S-1', { bay: 7 })).body.pending_proposal.row_id
    await approve(w.lead, first)
    expect((await w.lead.get<any>(`/api/change_proposals/${second}`)).state).toBe('Needs fresh review')
    expect((await w.lead.get<any>(`/api/change_proposals/${bay}`)).state).toBe('Pending')
  })
})

describe('a change that moves a row is judged on both sides', () => {
  test('moving a shelf from site A to site B waits for both site leads', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin)
    const id = (await edit(w.helper, 'S-1', { site: 'B' })).body.pending_proposal.row_id
    const once = await approve(w.lead, id)
    expect(once.state).toBe('Pending')
    expect(await approve(w.other, id)).toMatchObject({ state: 'Applied' })
    expect((await w.shelf('S-1')).site).toBe('B')
  })

  test('moving a shelf to a site no rule covers is refused', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin, { row_condition: [['site', '=', 'A']] })
    expect((await edit(w.helper, 'S-1', { site: 'B' })).status).toBe(403)
    expect((await w.shelf('S-1')).site).toBe('A')
  })
})

describe('several approvers, all or any', () => {
  test('all: the site lead\'s approval alone leaves it waiting; the Region Lead\'s too applies it', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await rule(admin, { maker_role: 'Helper', approvers: [{ resolver: SITE_LEAD }, { role: 'Region Lead' }] })
    const id = (await edit(w.helper, 'S-1', { label: 'Red box' })).body.pending_proposal.row_id
    expect((await w.mails(w.region))).toHaveLength(1)
    const once = await approve(w.lead, id)
    expect(once.state).toBe('Pending')
    expect(once.waiting_for.map((r: any) => r.approved_by)).toEqual([w.lead.user, null])
    // One person meets one approval.
    await expect(approve(w.lead, id)).rejects.toMatchObject({ status: 403 })
    expect((await w.shelf('S-1')).label).toBe('Blue box')
    expect(await approve(w.region, id)).toMatchObject({ state: 'Applied' })
    expect((await w.shelf('S-1')).label).toBe('Red box')
  })

  test('any: the Region Lead\'s approval applies it, and it no longer waits for the site lead', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await rule(admin, { maker_role: 'Helper', approvals_needed: 'Any', approvers: [{ resolver: SITE_LEAD }, { role: 'Region Lead' }] })
    const id = (await edit(w.helper, 'S-1', { label: 'Red box' })).body.pending_proposal.row_id
    expect(await approve(w.region, id)).toMatchObject({ state: 'Applied' })
    expect((await w.lead.get<any>('/api/change_proposals/waiting')).proposals).toEqual([])
    expect((await w.shelf('S-1')).label).toBe('Red box')
  })
})

describe('a maker\'s own change can apply at once', () => {
  test('the site lead\'s change to their own site applies, with no proposal and no email', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin)
    const { status, body } = await edit(w.lead, 'S-1', { label: 'Red box' })
    expect(status).toBe(201)
    expect(body.pending_proposal).toBeUndefined()
    expect((await w.shelf('S-1')).label).toBe('Red box')
    expect((await w.lead.get<any>('/api/row_proposals/Shelf/S-1')).proposals).toEqual([])
    expect(await sql`select 1 from email_queue where subject like 'Approval required%'`).toEqual([])
    const [version] = await sql`select created_by from version where ref_table = 'Shelf' and ref_name = 'S-1' order by created_at desc limit 1`
    expect(version.created_by).toBe(w.lead.user)
  })

  test('approval beats apply when both match', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await rule(admin, { maker_role: 'Site Lead', outcome: 'Apply and log' })
    await rule(admin, { governed_columns: 'bay', maker_role: 'Site Lead', approvers: [{ role: 'Region Lead' }] })
    expect((await edit(w.lead, 'S-1', { label: 'Red box' })).status).toBe(201)
    expect((await edit(w.lead, 'S-1', { label: 'Green box', bay: 3 })).status).toBe(202)
    expect(await w.shelf('S-1')).toMatchObject({ label: 'Red box', bay: 1 })
  })
})

describe('a change no rule allows is refused', () => {
  test('rules differ by row: a Helper may change site A, and site B is refused with a note to System Managers', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin, { row_condition: [['site', '=', 'A']] })
    expect((await edit(w.helper, 'S-1', { label: 'Red box' })).status).toBe(202)
    const { status, body } = await edit(w.helper, 'S-9', { label: 'Red box' })
    expect(status).toBe(403)
    expect(JSON.stringify(body)).toContain('No approval rule covers this change to Shelf')
    expect((await w.shelf('S-9')).label).toBe('Blue box')
    const notes = await w.mails(w.manager)
    expect(notes.map(n => n.subject)).toEqual(['No approval rule covers a change to Shelf'])
    // Once an hour, not per attempt.
    await edit(w.helper, 'S-9', { label: 'Red box' })
    expect(await w.mails(w.manager)).toHaveLength(1)
  })

  test('a central Table: only Region Leads make changes, and a site lead is refused', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await rule(admin, { maker_role: 'Region Lead', outcome: 'Apply and log' })
    expect((await edit(w.lead, 'S-1', { label: 'Red box' })).status).toBe(403)
    expect((await edit(w.region, 'S-1', { label: 'Red box' })).status).toBe(201)
  })

  test('a Table with no rules, or only disabled ones, works as before', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    expect((await edit(w.helper, 'S-1', { label: 'Red box' })).status).toBe(201)
    await rule(admin, { maker_role: 'Region Lead', outcome: 'Apply and log', enabled: false })
    expect((await edit(w.helper, 'S-1', { label: 'Green box' })).status).toBe(201)
  })

  test('rules narrow permissions, never widen them', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await grantRole(admin, { role: 'Visitor', table: 'Shelf', can_read: true })
    const visitor = await createUser({ email: `visitor-${randomUUID()}@example.test`, roles: ['Visitor'] })
    await rule(admin, { maker_role: 'Visitor', outcome: 'Apply and log' })
    expect((await edit(visitor, 'S-1', { label: 'Red box' })).status).toBe(403)
  })
})

describe('every way of changing a row obeys the rules', () => {
  test('a new shelf waits, and is not in the Table until the site lead approves it', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin)
    const response = await w.helper.fetch('/api/table/Shelf', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row_id: 'S-20', site: 'A', label: 'New box' }) })
    expect(response.status).toBe(202)
    const held = await response.json() as any
    expect(held).toMatchObject({ row_id: null, pending_proposal: { state: 'Pending' } })
    expect(await w.shelf('S-20')).toBeUndefined()
    const decided = await approve(w.lead, held.pending_proposal.row_id)
    expect(decided).toMatchObject({ state: 'Applied', operation: 'create', result_row: 'S-20' })
    expect(await w.shelf('S-20')).toMatchObject({ site: 'A', label: 'New box', created_by: w.helper.user })
  })

  test('a bulk edit holds each row as its own proposal', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin)
    const result = await w.helper.post<any>('/api/table/Shelf:bulk-edit', { rows: ['S-1', 'S-2', 'S-3'], values: { label: 'Red box' } })
    expect(result).toEqual({ changed: 0, waiting_for_approval: ['S-1', 'S-2', 'S-3'] })
    for (const id of ['S-1', 'S-2', 'S-3']) expect((await w.shelf(id)).label).toBe('Blue box')
    expect((await w.lead.get<any>('/api/change_proposals/waiting')).proposals).toHaveLength(3)
  })

  test('an import by a Helper makes pending proposals, not direct writes', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await grantRole(admin, { role: 'Helper', table: 'Import Log', can_read: true })
    await helperWaitsForLead(admin)
    const response = await w.helper.fetch('/api/table/Shelf:import', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_column: 'row_id', rows: [{ row_id: 'S-1', site: 'A', label: 'Imported box' }, { row_id: 'S-30', site: 'A', label: 'Imported new' }] }) })
    expect(response.status).toBeLessThan(300)
    expect(await response.json()).toMatchObject({ updated: 0, inserted: 0, failed: [], waiting_for_approval: 2 })
    expect((await w.shelf('S-1')).label).toBe('Blue box')
    expect(await w.shelf('S-30')).toBeUndefined()
    const waiting = (await w.lead.get<any>('/api/change_proposals/waiting')).proposals
    expect(waiting.map((p: any) => [p.operation, p.target_row]).sort()).toEqual([['create', null], ['update', 'S-1']])
  })

  test('a bulk edit with one refused row changes none', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin, { row_condition: [['site', '=', 'A']] })
    await expect(w.helper.post('/api/table/Shelf:bulk-edit', { rows: ['S-1', 'S-9'], values: { label: 'Red box' } })).rejects.toMatchObject({ status: 403 })
    expect((await w.lead.get<any>('/api/change_proposals/waiting')).proposals).toEqual([])
  })

  test('the maker loses write permission before approval: approving is refused and nothing changes', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await helperWaitsForLead(admin)
    const id = (await edit(w.helper, 'S-1', { label: 'Red box' })).body.pending_proposal.row_id
    await sql`delete from permission where role = 'Helper' and ref_table = 'Shelf' and operation = 'update'`
    const { invalidateMeta } = await import('../src/meta')
    invalidateMeta()
    await expect(approve(w.lead, id)).rejects.toMatchObject({ status: 403 })
    expect((await w.shelf('S-1')).label).toBe('Blue box')
    expect((await w.lead.get<any>(`/api/change_proposals/${id}`)).state).toBe('Pending')
  })
})

describe('approval rules are data a System Manager keeps', () => {
  test('only a System Manager writes rules, and each change is in the history', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await grantRole(admin, { role: 'Helper', table: 'Approval Rule', can_read: true, can_write: true, can_create: true })
    await expect(w.helper.post('/api/save_row', { table: 'Approval Rule', row: { ref_table: 'Shelf', outcome: 'Apply and log', operations: 'Changes' } }))
      .rejects.toMatchObject({ status: 403 })
    const saved = await w.manager.post<any>('/api/save_row', { table: 'Approval Rule', row: { ref_table: 'Shelf', operations: 'Changes', outcome: 'Apply and log', maker_role: 'Helper' } })
    await w.manager.post('/api/save_row', { table: 'Approval Rule', row: { row_id: saved.row_id, updated_at: saved.updated_at, enabled: false } })
    expect((await sql`select 1 from version where ref_table = 'Approval Rule' and ref_name = ${saved.row_id}`).length).toBeGreaterThan(0)
  })

  test('a rule that can\'t work is refused when saved', async ({ admin, createUser }) => {
    await setUp(admin, createUser)
    const refused = async (values: Rule, message: RegExp) => {
      const response = await admin.fetch('/api/save_row', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: 'Approval Rule', row: { ref_table: 'Shelf', operations: 'Changes', outcome: 'Route to approvers', approvers: [], ...values } }) })
      expect(response.status).toBe(417)
      expect(JSON.stringify(await response.json())).toMatch(message)
    }
    await refused({ maker_role: 'Helper' }, /needs at least one approver/)
    await refused({ maker_resolver: SITE_LEAD, approvers: [{ resolver: SITE_LEAD }] }, /only approver would be the maker/)
    await refused({ maker_resolver: SITE_LEAD, approvers: [{ resolver: SITE_LEAD }, { role: 'Region Lead' }] }, /only approver would be the maker/)
    await refused({ approvers: [{ role: 'Region Lead', resolver: SITE_LEAD }] }, /a role or a person an app names/)
    await refused({ approvers: [{ resolver: 'approvalproof.nobody' }] }, /No running app names people/)
    await refused({ governed_columns: 'colour', approvers: [{ role: 'Region Lead' }] }, /has no column colour/)
    await refused({ row_condition: [['site', 'between', 'A']], approvers: [{ role: 'Region Lead' }] }, /operator between/)
    await refused({ ref_table: 'Person', approvers: [{ role: 'Region Lead' }] }, /only an ordinary Table/)
    await admin.post('/api/table_def', { name: 'Unlogged', columns: [{ column_name: 'label', column_type: 'Data' }] })
    await sql`update table_def set track_changes = false where name = 'Unlogged'`
    ;(await import('../src/meta')).invalidateMeta('Unlogged')
    await refused({ ref_table: 'Unlogged', approvers: [{ role: 'Region Lead' }] }, /Turn on history/)
    // "Any" with another approver than the maker is fine; "Apply and log" needs no approver.
    await rule(admin, { maker_resolver: SITE_LEAD, approvals_needed: 'Any', approvers: [{ resolver: SITE_LEAD }, { role: 'Region Lead' }] })
    await rule(admin, { maker_role: 'Helper', outcome: 'Apply and log' })
  })

  test('a resolver that reads outside its declaration names nobody', async ({ admin, createUser }) => {
    const w = await setUp(admin, createUser)
    await rule(admin, { maker_role: 'Helper', approvers: [{ resolver: 'approvalproof.broken' }] })
    const { status, body } = await edit(w.helper, 'S-1', { label: 'Red box' })
    expect(status).toBe(403)
    expect(JSON.stringify(body)).toMatch(/Nobody else can approve/)
  })
})
