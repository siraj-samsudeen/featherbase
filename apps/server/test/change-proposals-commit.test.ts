import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { sql } from '../src/db'
import { discoverPackages, runPackageAction } from '../src/runtime-packages'
import { installApp, uninstallApp } from '../src/apps'
import { saveDoc } from '../src/document'
import { createTable, tableRelation } from '../src/table-engine'
import { app } from '../src/index'

// #975: two approvals of one proposal, on independent connections, must COMMIT to prove anything.
// Run: CHANGE_PROPOSAL_COMMIT_PROOF=1 DATABASE_URL=..._actions_commit_e2e
//      FEATHERBASE_ENV=test pnpm --filter server exec vitest run test/change-proposals-commit.test.ts
void app
const prove = process.env.CHANGE_PROPOSAL_COMMIT_PROOF === '1' ? test : test.skip

prove('real commits: two approvers approving at once apply it once', async () => {
  const [identity] = await sql`select current_database() as name, (select value from internal_metadata where key = 'environment') as environment`
  expect(String(identity.name).endsWith('_actions_commit_e2e')).toBe(true)
  expect(identity.environment).toBe('test')
  const TABLE = 'Placement'
  expect(await discoverPackages([resolve('../..', 'test-apps/proposal-proof')])).toEqual([])
  await installApp('proposalproof')
  await createTable({ name: TABLE, id_pattern: 'field:placement_id', columns: [
    { column_name: 'placement_id', column_type: 'Data', reqd: true }, { column_name: 'label', column_type: 'Data' }, { column_name: 'site', column_type: 'Data' },
    { column_name: 'starts_on', column_type: 'Date' }, { column_name: 'ends_on', column_type: 'Date' }, { column_name: 'source', column_type: 'Data' } ] } as never)
  const people: string[] = []
  try {
    await saveDoc('App Setting', { row_id: 'proposalproof.linked_tables', value: JSON.stringify([TABLE]) }, 'Administrator', 'insert')
    await saveDoc('Role', { row_id: 'Proof Editor' }, 'Administrator', 'insert')
    for (const who of ['maker', 'first', 'second']) {
      const email = `${who}-${randomUUID()}@example.test`
      const { row_id } = await saveDoc('Person', { email, full_name: who, enabled: true }, 'Administrator', 'insert')
      await sql`update person set password_hash = 'made-up' where row_id = ${String(row_id)}`
      people.push(String(row_id))
    }
    for (const person of people.slice(1)) await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values (${randomUUID()}, ${person}, 'Person', 'roles', 'Proof Editor')`
    await saveDoc(TABLE, { placement_id: 'R-1', label: 'Sarees', site: 'North', starts_on: '2026-10-01' }, 'Administrator', 'insert')
    const approvers = { people: [], fallbackRoles: ['Proof Editor'] }
    const act = (user: string, payload: object) => runPackageAction('proposalproof', 'probe', { idempotencyKey: randomUUID(), payload }, user) as Promise<{ result: { row_id: string; state: string } }>
    const { result: proposal } = await act(people[0], { op: 'propose', request: { table: TABLE, row: 'R-1', changes: { label: 'Silk' }, approvers } })
    const outcomes = await Promise.allSettled(['R-2', 'R-3'].map((id, index) =>
      act(people[index + 1], { op: 'approve', id: proposal.row_id, decision: { approvers, effectiveOn: '2026-11-05', newRow: { placement_id: id } } })))
    expect(outcomes.map(o => o.status).sort()).toEqual(['fulfilled', 'rejected'])
    const rows = await sql`select row_id from ${sql(await tableRelation(TABLE))} order by row_id`
    expect(rows).toHaveLength(2)
    const [row] = await sql`select proposal_state, decided_by from change_proposal where row_id = ${proposal.row_id}`
    expect(row.proposal_state).toBe('Applied')

    // Two proposals on one row, approved at once: they queue at the row, with no deadlock. One
    // applies; the other finds it was sent back for a fresh review.
    await saveDoc(TABLE, { placement_id: 'S-1', label: 'Cotton', site: 'South', starts_on: '2026-10-01' }, 'Administrator', 'insert')
    const asks = await Promise.all(['Linen', 'Wool'].map(label => act(people[0], { op: 'propose', request: { table: TABLE, row: 'S-1', changes: { label }, approvers } })).map(p => p))
    const both = await Promise.allSettled(asks.map(({ result }, index) =>
      act(people[index + 1], { op: 'approve', id: result.row_id, decision: { approvers, effectiveOn: '2026-11-05', newRow: { placement_id: `S-${index + 2}` } } })))
    for (const settled of both) if (settled.status === 'rejected') expect(String(settled.reason.message)).toContain('already been decided')
    const states = (await sql`select proposal_state from change_proposal where target_row = 'S-1'`).map(r => String(r.proposal_state)).sort()
    expect(states).toEqual(['Applied', 'Needs fresh review'])

    // Two new rows that a rule says can't both exist, and no row to queue at: they queue on the key.
    const adds = [await act(people[0], { op: 'propose', request: { table: TABLE, row: null, changes: { label: 'Only one', site: 'East' }, approvers } }),
      await act(people[1], { op: 'propose', request: { table: TABLE, row: null, changes: { label: 'Only one', site: 'West' }, approvers } })]
    await Promise.all(adds.map(({ result }, index) =>
      act(people[index + 1], { op: 'add_once', key: 'only-one', label: 'Only one', id: result.row_id, decision: { approvers, effectiveOn: '2026-11-05', newRow: { placement_id: `O-${index}` } } })))
    expect((await sql`select count(*)::int as n from ${sql(await tableRelation(TABLE))} where label = 'Only one'`)[0].n).toBe(1)

    // #1191: a change that applied at once, undone by two reviewers at once, or undone and
    // confirmed at once: exactly one of them wins, and the rows are what that one left.
    await saveDoc('Approval Type', { row_id: 'proposalproof.label_change', mode: 'Apply now, review after' }, 'Administrator', 'insert')
    const applyNow = async (row: string, stamp: string) => (await act(people[0], { op: 'propose', request: { table: TABLE, row, changes: { label: `Applied ${stamp}` }, approvers,
      type: 'label_change', apply: { effectiveOn: '2026-11-05', newRow: { placement_id: stamp } } } })).result
    await saveDoc(TABLE, { placement_id: 'U-1', label: 'Cotton', site: 'South', starts_on: '2026-10-01' }, 'Administrator', 'insert')
    const twice = await applyNow('U-1', 'U-2')
    const undos = await Promise.allSettled(people.slice(1).map(person =>
      act(person, { op: 'undo', id: twice.row_id, decision: { approvers, reason: 'Wrong' } })))
    expect(undos.map(o => o.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect((await sql`select proposal_state from change_proposal where row_id = ${twice.row_id}`)[0].proposal_state).toBe('Undone')
    expect((await sql`select ends_on from ${sql(await tableRelation(TABLE))} where row_id = 'U-1'`)[0].ends_on).toBeNull()

    await saveDoc(TABLE, { placement_id: 'V-1', label: 'Cotton', site: 'South', starts_on: '2026-10-01' }, 'Administrator', 'insert')
    const raced = await applyNow('V-1', 'V-2')
    const mixed = await Promise.allSettled([act(people[1], { op: 'undo', id: raced.row_id, decision: { approvers, reason: 'Wrong' } }),
      act(people[2], { op: 'confirm', id: raced.row_id, decision: { approvers } })])
    expect(mixed.map(o => o.status).sort()).toEqual(['fulfilled', 'rejected'])
    const [after] = await sql`select proposal_state from change_proposal where row_id = ${raced.row_id}`
    const [added] = await sql`select retired_at from ${sql(await tableRelation(TABLE))} where row_id = 'V-2'`
    expect(after.proposal_state === 'Undone' ? added.retired_at !== null : after.proposal_state === 'Confirmed' && added.retired_at === null).toBe(true)
  } finally {
    // A disposable database: nothing here is cleaned up but the app's hold on it.
    await uninstallApp('proposalproof').catch(() => {})
  }
})
