import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { sql } from '../src/db'
import { discoverPackages, runPackageAction } from '../src/runtime-packages'
import { installApp, uninstallApp } from '../src/apps'
import { saveDoc } from '../src/document'
import { createTable, deleteTable, tableRelation } from '../src/table-engine'
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
      people.push(String((await saveDoc('Person', { email, full_name: who, enabled: true }, 'Administrator', 'insert')).row_id))
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
  } finally {
    await sql`delete from change_proposal_column`; await sql`delete from change_proposal_approver`; await sql`delete from change_proposal`
    await sql`delete from version where ref_table = ${TABLE}`
    await sql`delete from has_role where role = 'Proof Editor'`
    if (people.length) await sql`delete from person where row_id in ${sql(people)}`
    await sql`delete from app_setting where row_id = 'proposalproof.linked_tables'`
    await deleteTable(TABLE).catch(() => {})
    await uninstallApp('proposalproof').catch(() => {})
  }
})
