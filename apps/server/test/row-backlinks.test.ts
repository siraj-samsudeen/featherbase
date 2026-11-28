import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { expectRefused, grantRole } from './fixtures'

// The table-level :backlinks collection action (row-connections.ts): which
// Tables point at this one, before any row is chosen — the Explore picker and
// relationship map read it. Readable backlink Tables only.

const EMP = 'Blk Employee'
const ATT = 'Blk Attendance'
const ROLE = 'Blk Employee Reader'

async function setup(admin: TestClient) {
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: EMP, id_pattern: 'prompt', columns: [{ column_name: 'dept', column_type: 'Data' }] })
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: ATT, columns: [{ column_name: 'employee', column_type: 'Reference', reference_table: EMP }] })
}

const backlinkTables = async (client: TestClient) =>
  (await client.get<{ backlinks: { table: string }[] }>(`/api/table/${encodeURIComponent(EMP)}:backlinks`))
    .backlinks.map((link) => link.table).filter((table) => table.startsWith('Blk '))

describe('Tables that point at a table', () => {
  test('lists every Table whose links point at this one', async ({ admin }) => {
    await setup(admin)
    expect(await backlinkTables(admin)).toEqual([ATT])
  })

  test('leaves out Tables the caller cannot read, and refuses a caller who cannot read the Table itself', async ({ admin, createUser }) => {
    await setup(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
    await grantRole(admin, { table: EMP, role: ROLE, can_read: true })
    const reader = await createUser({ roles: [ROLE] })
    expect(await backlinkTables(reader)).toEqual([])
    const outsider = await createUser({ roles: [] })
    await expectRefused(outsider.get(`/api/table/${encodeURIComponent(EMP)}:backlinks`), 403)
  })

  // #1276: a sub-table's rows are held by the Tables with a Sub-table column of
  // it, which a list of those rows can be Linked to through `parent`.
  test('names the readable Tables holding a sub-table', async ({ admin, createUser }) => {
    await admin.post('/api/table_def', { name: 'Blk Line', kind: 'sub_table', columns: [{ column_name: 'qty', column_type: 'Int' }] })
    for (const name of ['Blk Order', 'Blk Return'])
      await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name, columns: [{ column_name: 'lines', column_type: 'Sub-table', row_table: 'Blk Line' }] })
    const holders = async (client: TestClient) =>
      (await client.get<{ holders: string[] }>(`/api/table/${encodeURIComponent('Blk Line')}:backlinks`)).holders
    expect(await holders(admin)).toEqual(['Blk Order', 'Blk Return'])
    await grantRole(admin, { table: ['Blk Line', 'Blk Order'], role: 'Blk Line Reader', can_read: true })
    expect(await holders(await createUser({ roles: ['Blk Line Reader'] }))).toEqual(['Blk Order'])
  })
})
